import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme.dart';
import '../widgets/storefront_scaffold.dart';

/// Shown right after a successful checkout (order passed in as router
/// `extra`, not re-fetched). See router.dart's redirect on this route for
/// what happens on a hard refresh, where that extra is gone.
class OrderConfirmationScreen extends StatelessWidget {
  final Order order;

  const OrderConfirmationScreen({super.key, required this.order});

  @override
  Widget build(BuildContext context) {
    return StorefrontScaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.check_circle,
                  color: StorefrontColors.success,
                  size: 64,
                ),
                const SizedBox(height: 16),
                Text(
                  'Order placed!',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                Text(
                  'Order number ${order.orderNumber}',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  'Total ₵${order.total.toStringAsFixed(2)} · Status: ${order.status}',
                  style: const TextStyle(color: StorefrontColors.inkMuted),
                ),
                const SizedBox(height: 8),
                Text(
                  order.isPickup
                      ? 'We\'ll text/email you when it\'s ready to collect. Pay on pickup.'
                      : 'We\'ll be in touch to arrange delivery. Pay on delivery.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: StorefrontColors.inkMuted),
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: () => context.go('/'),
                  child: const Text('Continue shopping'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
