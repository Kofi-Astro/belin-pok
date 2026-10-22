/// The one signed-in session for the whole admin app (see AuthSession in
/// packages/belpok_core). A single shared instance, the way
/// `Supabase.instance` used to be: every screen builds its own ApiClient,
/// and they all need to send -- and refresh -- the same tokens.
library;

import 'package:belpok_core/belpok_core.dart';

import 'config.dart';

final authSession = AuthSession(
  baseUrl: AppConfig.apiBaseUrl,
  storageKey: 'belpok.admin.session',
);
