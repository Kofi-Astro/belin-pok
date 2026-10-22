import 'package:belpok_core/belpok_core.dart' show AuthSession;
import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'models.dart';

enum AuthStatus { unknown, signedOut, signedIn }

/// App-wide auth state for retail customers. Unlike the admin app,
/// signedOut is a normal, fully-usable state here -- browsing and guest
/// checkout don't need an account at all.
///
/// Signing up creates the login and the customer profile in one call (see
/// POST /auth/signup), so there's no in-between "signed in but not
/// registered" state any more -- with Supabase, sign-up and creating the
/// customer record were two separate steps.
class AuthController extends ChangeNotifier {
  final StorefrontApiClient api;
  final AuthSession session;
  AuthStatus status = AuthStatus.unknown;
  Customer? profile;
  String? error;

  AuthController(this.api, this.session) {
    session.addListener(_onSessionChange);
    session.restore();
  }

  Future<void> _onSessionChange() async {
    if (!session.isSignedIn) {
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
      status = AuthStatus.signedOut;
      if (e.statusCode == 403) {
        // A staff login has no customer profile -- say so, rather than
        // leaving them "signed in" to an account page that can't load.
        error = 'That account is for the admin app, not the shop.';
        await session.signOut();
      }
    }
    notifyListeners();
  }

  /// Creates an account and signs straight in. Returns whether it worked;
  /// on failure the reason is in [error].
  Future<bool> signUp({
    required String email,
    required String password,
    required String fullName,
    String? phone,
  }) => _attempt(
    () => session.signUp(
      email: email,
      password: password,
      fullName: fullName,
      phone: phone,
    ),
  );

  Future<bool> signIn(String email, String password) =>
      _attempt(() => session.signIn(email, password));

  /// Emails a reset link (to the storefront's /reset-password screen).
  /// Succeeds the same way whether or not the email has an account.
  Future<bool> requestPasswordReset(String email) =>
      _attempt(() => session.requestPasswordReset(email));

  /// Redeems a reset link's token, which also signs the customer in.
  Future<bool> resetPassword(String token, String newPassword) =>
      _attempt(() => session.setPasswordWithToken(token, newPassword));

  Future<void> signOut() => session.signOut();

  Future<bool> _attempt(Future<void> Function() action) async {
    error = null;
    notifyListeners();
    try {
      await action();
      return true;
    } on ApiException catch (e) {
      error = e.message;
    } catch (_) {
      error = "Couldn't reach the shop -- check your connection";
    }
    notifyListeners();
    return false;
  }
}
