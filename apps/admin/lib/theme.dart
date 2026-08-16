// AppColors/buildAppTheme now live in belpok_core (shared with
// apps/storefront -- same brand, same products). Re-exported here so the
// rest of this app's existing `import 'theme.dart'` / relative imports
// don't all need rewriting.
export 'package:belpok_core/belpok_core.dart' show AppColors, buildAppTheme;
