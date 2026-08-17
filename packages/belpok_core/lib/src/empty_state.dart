import 'package:flutter/material.dart';

/// A friendly "nothing here yet" placeholder that tells the user what to
/// expect next, instead of a bare "No items." Shared by both apps: an
/// admin table with nothing in it and a storefront catalog with nothing
/// in it are the same underlying situation. Tinted from the surrounding
/// theme's primary color (Theme.of(context), not a hardcoded brand
/// constant) so it automatically matches each app's own palette --
/// admin's navy, the storefront's deep purple, or anything either app
/// picks later -- without needing an app-specific override.
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.06),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 40, color: accent.withValues(alpha: 0.5)),
            ),
            const SizedBox(height: 16),
            Text(
              title,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).textTheme.bodyMedium?.color?.withValues(alpha: 0.6),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
