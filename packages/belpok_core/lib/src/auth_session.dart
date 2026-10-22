import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client_base.dart';

/// The signed-in session, shared by everything in one app that talks to
/// the API -- the replacement for `Supabase.instance.client.auth`. See
/// services/api/app/routers/auth.py for the server side of every call here.
///
/// Holds two tokens:
/// - a short-lived **access token** (minutes), sent on every request by
///   ApiHttp and kept only in memory;
/// - a long-lived **refresh token**, persisted on the device so a reload
///   or app restart stays signed in, and traded for a fresh pair whenever
///   the access token is about to expire. Each refresh token works once:
///   the server issues a new one every time.
///
/// Listeners are notified whenever signed-in-ness (or must-change-password)
/// changes, which is what each app's AuthController reacts to.
///
/// Storage note: on the web, shared_preferences is the browser's
/// localStorage -- the same place supabase_flutter kept its session, so
/// this is no change in exposure.
class AuthSession extends ChangeNotifier {
  final String baseUrl;

  /// Distinct per app (e.g. 'belpok.admin.session'), so the admin app and
  /// storefront never read each other's session on a device that has both.
  final String storageKey;

  AuthSession({required this.baseUrl, required this.storageKey});

  String? _accessToken;
  DateTime? _accessTokenExpiresAt;
  String? _refreshToken;
  bool _mustChangePassword = false;

  // While a refresh is in flight, every caller awaits that same one.
  // Without this, several requests firing at once with an expired token
  // would each try to refresh -- and since a refresh token only works
  // once, all but the first would fail and sign the user out.
  Future<bool>? _refreshing;

  bool get isSignedIn => _refreshToken != null;

  /// True for an account that must pick a new password before doing
  /// anything else (the bootstrap owner) -- the admin app's router sends
  /// it straight to its set-password screen.
  bool get mustChangePassword => _mustChangePassword;

  /// Picks up a session saved by a previous visit. Call once at startup;
  /// listeners hear the outcome either way.
  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(storageKey);
    if (saved == null) {
      notifyListeners();
      return;
    }
    final data = jsonDecode(saved) as Map<String, dynamic>;
    _refreshToken = data['refresh_token'] as String?;
    _mustChangePassword = data['must_change_password'] as bool? ?? false;
    // No access token is saved, so get one now -- this also confirms the
    // saved session is still valid (it may have been signed out from
    // another device, or the account deactivated, since).
    await refresh();
    notifyListeners();
  }

  /// A valid access token, refreshing first if the current one expires in
  /// the next 30 seconds. Null when signed out.
  Future<String?> accessToken() async {
    if (_refreshToken == null) return null;
    final expiresAt = _accessTokenExpiresAt;
    final expiringSoon =
        expiresAt == null ||
        DateTime.now().isAfter(expiresAt.subtract(const Duration(seconds: 30)));
    if (_accessToken == null || expiringSoon) await refresh();
    return _accessToken;
  }

  /// Trades the refresh token for a new pair. Returns whether the session
  /// is still good. A refused refresh (expired, signed out elsewhere,
  /// deactivated) signs this device out; a network failure doesn't --
  /// being briefly offline shouldn't cost anyone their session.
  Future<bool> refresh() {
    return _refreshing ??= _refresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _refresh() async {
    final refreshToken = _refreshToken;
    if (refreshToken == null) return false;
    try {
      final json = await _post('/auth/refresh', {
        'refresh_token': refreshToken,
      });
      await _apply(json as Map<String, dynamic>);
      return true;
    } on ApiException catch (e) {
      if (e.statusCode == 401 || e.statusCode == 403) await _clear();
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Signs in with a username or email. Throws ApiException (with a
  /// message fit to show) on failure.
  Future<void> signIn(String identifier, String password) async {
    final json = await _post('/auth/login', {
      'identifier': identifier,
      'password': password,
    });
    await _apply(json as Map<String, dynamic>);
  }

  /// Storefront registration: creates the login and customer profile in
  /// one call, and signs straight in.
  Future<void> signUp({
    required String email,
    required String password,
    required String fullName,
    String? phone,
  }) async {
    final json = await _post('/auth/signup', {
      'email': email,
      'password': password,
      'full_name': fullName,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
    });
    await _apply(json as Map<String, dynamic>);
  }

  /// Redeems an invite or password-reset link's token, setting the
  /// password and signing straight in.
  Future<void> setPasswordWithToken(String token, String newPassword) async {
    final json = await _post('/auth/set-password', {
      'token': token,
      'new_password': newPassword,
    });
    await _apply(json as Map<String, dynamic>);
  }

  /// Changes the signed-in user's password. The server signs out every
  /// other device and hands this one a fresh session.
  Future<void> changePassword(String newPassword) async {
    final json = await _post('/auth/change-password', {
      'new_password': newPassword,
    }, bearer: await accessToken());
    await _apply(json as Map<String, dynamic>);
  }

  /// Asks for a reset link by email. Succeeds the same way whether or not
  /// the email has an account (the server never says which).
  Future<void> requestPasswordReset(String email) async {
    await _post('/auth/forgot-password', {'email': email});
  }

  /// Signs this device out. Always succeeds locally, even offline -- the
  /// server-side revoke is best-effort, and the refresh token is dropped
  /// from the device either way.
  Future<void> signOut() async {
    final refreshToken = _refreshToken;
    await _clear();
    if (refreshToken != null) {
      try {
        await _post('/auth/logout', {'refresh_token': refreshToken});
      } catch (_) {}
    }
  }

  Future<void> _apply(Map<String, dynamic> json) async {
    _accessToken = json['access_token'] as String;
    _refreshToken = json['refresh_token'] as String;
    _accessTokenExpiresAt = DateTime.now().add(
      Duration(seconds: json['expires_in'] as int),
    );
    _mustChangePassword = json['must_change_password'] as bool? ?? false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      storageKey,
      jsonEncode({
        'refresh_token': _refreshToken,
        'must_change_password': _mustChangePassword,
      }),
    );
    notifyListeners();
  }

  Future<void> _clear() async {
    final wasSignedIn = isSignedIn;
    _accessToken = null;
    _accessTokenExpiresAt = null;
    _refreshToken = null;
    _mustChangePassword = false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(storageKey);
    if (wasSignedIn) notifyListeners();
  }

  // Deliberately not ApiHttp: ApiHttp asks this class for tokens, so
  // routing these calls back through it would loop.
  Future<dynamic> _post(
    String path,
    Map<String, dynamic> body, {
    String? bearer,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: {
        'Content-Type': 'application/json',
        if (bearer != null) 'Authorization': 'Bearer $bearer',
      },
      body: jsonEncode(body),
    );
    return decodeApiResponse(response);
  }
}
