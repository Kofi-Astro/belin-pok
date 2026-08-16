import 'dart:convert';

import 'package:http/http.dart' as http;

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
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

  /// Called fresh on every request rather than captured once, so it
  /// always reflects the current Supabase Auth session (which can sign
  /// in/out/refresh over the app's lifetime).
  final Map<String, String> Function() headers;

  ApiHttp({required this.baseUrl, required this.headers});

  Future<dynamic> get(String path, [Map<String, String>? query]) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final response = await http.get(uri, headers: headers());
    return _decode(response);
  }

  Future<dynamic> post(String path, Map<String, dynamic> body) async {
    final response = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: headers(),
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Future<dynamic> patch(String path, Map<String, dynamic> body) async {
    final response = await http.patch(
      Uri.parse('$baseUrl$path'),
      headers: headers(),
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Future<dynamic> delete(String path) async {
    final response = await http.delete(
      Uri.parse('$baseUrl$path'),
      headers: headers(),
    );
    return _decode(response);
  }

  dynamic _decode(http.Response response) {
    if (response.statusCode >= 400) {
      String detail = response.body;
      try {
        detail =
            (jsonDecode(response.body) as Map<String, dynamic>)['detail']
                ?.toString() ??
            response.body;
      } catch (_) {}
      throw ApiException(response.statusCode, detail);
    }
    if (response.body.isEmpty) return null;
    return jsonDecode(response.body);
  }
}
