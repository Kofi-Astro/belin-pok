import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'auth_session.dart';

/// Thrown by ApiHttp for any non-2xx response. `message` is the FastAPI
/// error's `detail` field when the body is JSON, or the raw response body
/// otherwise -- always something safe to show directly in a SnackBar.
class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
}

/// Turns an API response into its decoded JSON body (null for an empty
/// body, e.g. a 204), or throws ApiException for any error status. Shared
/// by ApiHttp and AuthSession so both report errors identically.
dynamic decodeApiResponse(http.Response response) {
  if (response.statusCode >= 400) {
    String detail = response.body;
    try {
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      final raw = decoded['detail'];
      // FastAPI validation errors (422) put a list of problems in
      // `detail`; the first one's message is the useful part to show.
      detail = raw is List && raw.isNotEmpty && raw.first is Map
          ? (raw.first as Map)['msg']?.toString() ?? response.body
          : raw?.toString() ?? response.body;
    } catch (_) {}
    throw ApiException(response.statusCode, detail);
  }
  if (response.body.isEmpty) return null;
  return jsonDecode(response.body);
}

/// The request/response/error-decoding plumbing shared by both apps'
/// ApiClient classes -- everything about *how* to talk to the FastAPI
/// backend, as opposed to *which endpoints* to call (each app's own
/// ApiClient owns that, since admin's are staff-scoped and storefront's
/// are public/customer-scoped).
///
/// Deliberately composition, not inheritance: each app's ApiClient holds
/// an ApiHttp rather than extending it. A `_`-prefixed member is
/// library-private in Dart, i.e. invisible even to a subclass defined in
/// another file -- extending across the apps/admin vs apps/storefront
/// library boundary would force every helper here to be public anyway, so
/// composition is both simpler and avoids that trap.
class ApiHttp {
  final String baseUrl;

  /// Where the bearer token comes from. Asked fresh on every request
  /// (it refreshes the token itself when it's about to expire), and asked
  /// to refresh once more if a request still comes back 401 -- e.g. the
  /// API's signing secret was rotated -- before that error is surfaced.
  /// Null for a client that only ever makes anonymous calls.
  final AuthSession? session;

  ApiHttp({required this.baseUrl, this.session});

  Future<dynamic> get(String path, [Map<String, String>? query]) {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    return _send((headers) => http.get(uri, headers: headers));
  }

  Future<dynamic> post(String path, Map<String, dynamic> body) => _send(
    (headers) => http.post(
      Uri.parse('$baseUrl$path'),
      headers: headers,
      body: jsonEncode(body),
    ),
  );

  Future<dynamic> patch(String path, Map<String, dynamic> body) => _send(
    (headers) => http.patch(
      Uri.parse('$baseUrl$path'),
      headers: headers,
      body: jsonEncode(body),
    ),
  );

  Future<dynamic> delete(String path) => _send(
    (headers) => http.delete(Uri.parse('$baseUrl$path'), headers: headers),
  );

  /// A multipart file upload (e.g. POST /uploads/product-photo). The
  /// request is rebuilt on a retry because a MultipartRequest's body
  /// stream can only be sent once.
  Future<dynamic> postFile(
    String path, {
    required String field,
    required Uint8List bytes,
    required String filename,
    required String contentType,
  }) => _send((headers) async {
    final request =
        http.MultipartRequest('POST', Uri.parse('$baseUrl$path'))
          // Content-Type is left to MultipartRequest -- it has to carry the
          // multipart boundary, so the JSON one from _headers can't be used.
          ..headers.addAll({...headers}..remove('Content-Type'))
          ..files.add(
            http.MultipartFile.fromBytes(
              field,
              bytes,
              filename: filename,
              contentType: MediaType.parse(contentType),
            ),
          );
    return http.Response.fromStream(await request.send());
  });

  Future<Map<String, String>> _headers() async {
    final token = await session?.accessToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  /// Sends a request, and if it's refused as unauthenticated while a
  /// session exists, refreshes that session and sends it once more. A
  /// refresh that fails signs the session out (see AuthSession.refresh),
  /// which is what moves the app back to its sign-in screen.
  Future<dynamic> _send(
    Future<http.Response> Function(Map<String, String> headers) send,
  ) async {
    var response = await send(await _headers());
    final session = this.session;
    if (response.statusCode == 401 &&
        session != null &&
        session.isSignedIn &&
        await session.refresh()) {
      response = await send(await _headers());
    }
    return decodeApiResponse(response);
  }
}
