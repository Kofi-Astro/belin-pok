import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';
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
}
