/// Shared package consumed by both apps/admin and apps/storefront (via a
/// path dependency in each app's pubspec.yaml) -- data models that mirror
/// the API's response shapes, the low-level HTTP client both apps' own
/// ApiClients are built on, the shared brand theme, and a couple of
/// widgets (like EmptyState) that look the same in both apps. Anything
/// that differs meaningfully between the two apps stays in the app
/// itself instead of being forced in here.
library;

export 'src/api_client_base.dart';
export 'src/empty_state.dart';
export 'src/models.dart';
export 'src/theme.dart';
