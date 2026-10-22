import 'package:belpok_core/belpok_core.dart' show AuthSession;
import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'models.dart';

enum AuthStatus { unknown, signedOut, signedIn, notStaff }

/// App-wide auth state for the admin app. AuthSession (packages/belpok_core)
/// answers "who are you?"; the `staff` row fetched from GET /staff/me
/// answers "what are you allowed to do?". A valid login with no staff row
/// -- a storefront customer's account -- is deliberately treated as not
/// signed in here (AuthStatus.notStaff), as is a deactivated staff member.
///
/// status starts as unknown while a saved session is restored, so the
/// router doesn't flash the sign-in screen at someone who's signed in.
class AuthController extends ChangeNotifier {
  final ApiClient api;
  final AuthSession session;
  AuthStatus status = AuthStatus.unknown;
  StaffProfile? profile;
  String? error;

  AuthController(this.api, this.session) {
    session.addListener(_onSessionChange);
    session.restore();
  }

  /// Forced on the bootstrap owner (and anyone flagged the same way) until
  /// they choose a new password -- the router won't let them past the
  /// set-password screen until then.
  bool get mustChangePassword => session.mustChangePassword;

  Future<void> _onSessionChange() async {
    if (!session.isSignedIn) {
      // Keep notStaff on screen after its automatic sign-out, so the
      // login screen can still say why.
      if (status != AuthStatus.notStaff) status = AuthStatus.signedOut;
      profile = null;
      notifyListeners();
      return;
    }
    try {
      profile = await api.getMyProfile();
      status = AuthStatus.signedIn;
    } on ApiException catch (e) {
      profile = null;
      if (e.statusCode == 403) {
        status = AuthStatus.notStaff;
        // Don't leave a customer's (or deactivated staff member's)
        // session sitting in the admin app.
        await session.signOut();
      } else {
        status = AuthStatus.signedOut;
      }
    }
    notifyListeners();
  }

  /// Signs in with a username (the bootstrap owner) or an email (everyone
  /// else). Failures land in [error] for the login screen to show.
  Future<void> signIn(String identifier, String password) async {
    error = null;
    if (status == AuthStatus.notStaff) status = AuthStatus.signedOut;
    notifyListeners();
    try {
      await session.signIn(identifier, password);
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
    } catch (_) {
      error = "Couldn't reach the server -- check your connection";
      notifyListeners();
    }
  }

  Future<void> signOut() => session.signOut();

  /// Returns null on success, or a message to show the user on failure.
  Future<String?> changePassword(String newPassword) =>
      _attempt(() => session.changePassword(newPassword));

  /// Sets a password from an invite or reset link's token, which also
  /// signs the person in. Returns null on success, or a message to show.
  Future<String?> setPasswordWithToken(String token, String newPassword) =>
      _attempt(() => session.setPasswordWithToken(token, newPassword));

  /// Emails the given address a "reset your password" link. Returns null
  /// on success (regardless of whether the address is a real staff
  /// account -- the API doesn't reveal that either way), or a message to
  /// show the user on failure.
  Future<String?> sendPasswordReset(String email) =>
      _attempt(() => session.requestPasswordReset(email));

  Future<String?> _attempt(Future<void> Function() action) async {
    try {
      await action();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (_) {
      return "Couldn't reach the server -- check your connection";
    }
  }
}
