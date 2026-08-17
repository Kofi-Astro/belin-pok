// EmptyState now lives in belpok_core (shared with apps/storefront -- an
// empty admin table and an empty storefront catalog are the same
// situation in the same brand language). Re-exported here so this app's
// existing `import '../widgets/empty_state.dart'` keeps resolving it.
export 'package:belpok_core/belpok_core.dart' show EmptyState;
