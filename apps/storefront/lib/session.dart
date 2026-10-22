/// The one signed-in session for the whole storefront (see AuthSession in
/// packages/belpok_core) -- shared the way `Supabase.instance` used to be.
/// Signed out is a perfectly normal state here: browsing and guest
/// checkout work without it.
library;

import 'package:belpok_core/belpok_core.dart';

import 'config.dart';

final authSession = AuthSession(
  baseUrl: AppConfig.apiBaseUrl,
  storageKey: 'belpok.storefront.session',
);
