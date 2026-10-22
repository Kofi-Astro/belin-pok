/// Build-time config. Overridden per-environment via --dart-define, e.g.:
///   flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8000
///   flutter build web --dart-define=API_BASE_URL=https://api.belpok.xyz
///
/// The API is the only backend this app talks to -- the catalog, sign-in,
/// checkout and product photos all go through it -- so its URL is the
/// only setting. Nothing secret belongs here: it's compiled into the client.
class AppConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:8000',
  );
}
