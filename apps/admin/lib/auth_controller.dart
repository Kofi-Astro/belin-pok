import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';
import 'config.dart';
import 'models.dart';

enum AuthStatus { unknown, signedOut, signedIn, notStaff }

/// App-wide auth/session state. Supabase Auth answers "who are you?"; the
/// `staff` row (fetched from the API, itself checked against the database's
/// RLS-protected staff table) answers "what are you allowed to do?". A
/// valid Supabase login with no matching staff row is deliberately treated
/// as not signed in to the admin app.
class AuthController extends ChangeNotifier {
  final ApiClient api;
  AuthStatus status = AuthStatus.unknown;
  StaffProfile? profile;
  String? error;

  /// True once a password-recovery link has been redeemed and until the
  /// user picks a new password -- the router uses this to force them to
  /// the set-password screen instead of straight into the dashboard.
  bool passwordRecovery = false;

  AuthController(this.api) {
    Supabase.instance.client.auth.onAuthStateChange.listen((data) {
      if (data.event == AuthChangeEvent.passwordRecovery) {
        passwordRecovery = true;
      }
      _onAuthChange(data.session);
    });
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
      status = e.statusCode == 403 ? AuthStatus.notStaff : AuthStatus.signedOut;
    }
    notifyListeners();
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

  Future<void> signOut() async {
    await Supabase.instance.client.auth.signOut();
  }

  /// Returns null on success, or a message to show the user on failure.
  Future<String?> changePassword(String newPassword) async {
    try {
      await Supabase.instance.client.auth.updateUser(
        UserAttributes(password: newPassword),
      );
      passwordRecovery = false;
      return null;
    } on AuthException catch (e) {
      return e.message;
    }
  }

  /// Emails the given address a "reset your password" link. Returns null
  /// on success (regardless of whether the address is a real staff
  /// account -- Supabase doesn't reveal that either way), or a message to
  /// show the user on failure.
  Future<String?> sendPasswordReset(String email) async {
    try {
      await Supabase.instance.client.auth.resetPasswordForEmail(
        email,
        redirectTo: AppConfig.appUrl,
      );
      return null;
    } on AuthException catch (e) {
      return e.message;
    }
  }
}
