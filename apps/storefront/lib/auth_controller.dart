import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';
import 'models.dart';

enum AuthStatus { unknown, signedOut, needsRegistration, signedIn }

/// App-wide auth/session state for retail customers. Unlike the admin app,
/// signedOut is a normal, fully-usable state here -- browsing and guest
/// checkout don't need an account at all. needsRegistration is the state
/// right after Supabase Auth sign-up and before POST /customers/register
/// has been called -- a valid Supabase session with no `customers` row yet.
class AuthController extends ChangeNotifier {
  final StorefrontApiClient api;
  AuthStatus status = AuthStatus.unknown;
  Customer? profile;
  String? error;

  AuthController(this.api) {
    Supabase.instance.client.auth.onAuthStateChange.listen(
      (data) => _onAuthChange(data.session),
    );
    _onAuthChange(Supabase.instance.client.auth.currentSession);
  }

  Future<void> _onAuthChange(Session? session) async {
    if (session == null) {
      status = AuthStatus.signedOut;
      profile = null;
      notifyListeners();
      return;
    }
    try {
      profile = await api.getMyProfile();
      status = AuthStatus.signedIn;
    } on ApiException catch (e) {
      profile = null;
      status = e.statusCode == 403
          ? AuthStatus.needsRegistration
          : AuthStatus.signedOut;
    }
    notifyListeners();
  }

  /// Returns true if sign-up left the caller with an active session
  /// (this Supabase project has email confirmation disabled), false if a
  /// confirmation email was sent instead and there's no session yet --
  /// the caller needs to show that explicitly rather than silently
  /// bouncing back to a blank sign-in form (auth.status stays signedOut
  /// either way until a session actually exists, so the /account route's
  /// redirect would otherwise send them straight back to /login with no
  /// explanation).
  Future<bool> signUp(String email, String password) async {
    error = null;
    notifyListeners();
    try {
      final response = await Supabase.instance.client.auth.signUp(
        email: email,
        password: password,
      );
      return response.session != null;
    } on AuthException catch (e) {
      error = e.message;
      notifyListeners();
      return false;
    }
  }

  Future<void> signIn(String email, String password) async {
    error = null;
    notifyListeners();
    try {
      await Supabase.instance.client.auth.signInWithPassword(
        email: email,
        password: password,
      );
    } on AuthException catch (e) {
      error = e.message;
      notifyListeners();
    }
  }

  /// Completes registration for a Supabase Auth user who doesn't have a
  /// `customers` row yet (see needsRegistration above).
  Future<void> completeRegistration({
    required String fullName,
    String? phone,
  }) async {
    error = null;
    try {
      profile = await api.registerCustomer(fullName: fullName, phone: phone);
      status = AuthStatus.signedIn;
    } on ApiException catch (e) {
      error = e.message;
    }
    notifyListeners();
  }

  Future<void> signOut() async {
    await Supabase.instance.client.auth.signOut();
  }
}
