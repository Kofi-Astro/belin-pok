/// Build-time config. Overridden per-environment via --dart-define, e.g.:
///   flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8000
///   flutter build web --dart-define=API_BASE_URL=https://api.belpok.xyz
///
/// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY are safe to ship in a client build
/// (that's what "publishable" means -- access is still governed by RLS).
/// The secret key never belongs in this app.
class AppConfig {
  static const supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://rkjcrvgtbrbdzjakgtpz.supabase.co',
  );

  static const supabasePublishableKey = String.fromEnvironment(
    'SUPABASE_PUBLISHABLE_KEY',
    defaultValue: 'sb_publishable_agfA1-RXp_BdCVXIrRi07A_98JqTxHO',
  );

  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:8000',
  );

  /// Where this app is actually hosted. Passed back to Supabase as the
  /// `redirectTo` for password-reset emails, so the link lands here
  /// instead of Supabase's default (localhost) Site URL.
  static const appUrl = String.fromEnvironment(
    'APP_URL',
    defaultValue: 'https://admin.belpok.xyz',
  );
}
