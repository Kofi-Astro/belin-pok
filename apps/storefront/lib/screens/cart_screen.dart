import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../cart.dart';
import '../config.dart';
import '../theme.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartController>();

    return cart.isEmpty
        ? const EmptyState(
            icon: Icons.shopping_bag_outlined,
            title: 'Your cart is empty',
            message: 'Add something you like and it\'ll show up here.',
          )
        : Column(
            children: [
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: cart.lines.length,
                  separatorBuilder: (context, index) =>
                      const Divider(height: 24),
                  itemBuilder: (context, index) {
                    final line = cart.lines[index];
                    return _CartLineTile(line: line);
                  },
                ),
              ),
              _CartSummary(cart: cart),
            ],
          );
  }
}

class _CartLineTile extends StatelessWidget {
  final CartLine line;

  const _CartLineTile({required this.line});

  @override
  Widget build(BuildContext context) {
    final cart = context.read<CartController>();
    final image = line.product.primaryImage;
    final variantLabel =
        line.variant.color != null && line.variant.color!.isNotEmpty
        ? '${line.variant.size} · ${line.variant.color}'
        : line.variant.size;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: 64,
            height: 64,
            child: image != null
                ? Image.network(
                    image.publicUrl(AppConfig.supabaseUrl),
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        Container(color: StorefrontColors.canvas),
                  )
                : Container(
                    color: StorefrontColors.canvas,
                    child: const Icon(
                      Icons.checkroom,
                      color: StorefrontColors.inkMuted,
                    ),
                  ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                line.product.name,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              Text(
                variantLabel,
                style: const TextStyle(color: StorefrontColors.inkMuted),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border.all(color: const Color(0xFFCBC6BB)),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.remove, size: 18),
                          onPressed: () => cart.updateQuantity(
                            line.variant.id,
                            line.quantity - 1,
                          ),
                        ),
                        Text('${line.quantity}'),
                        IconButton(
                          icon: const Icon(Icons.add, size: 18),
                          onPressed: line.quantity < line.variant.stockQuantity
                              ? () => cart.updateQuantity(
                                  line.variant.id,
                                  line.quantity + 1,
                                )
                              : null,
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => cart.remove(line.variant.id),
                    child: const Text('Remove'),
                  ),
                ],
              ),
            ],
          ),
        ),
        Text(
          '₵${line.lineTotal.toStringAsFixed(2)}',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}

class _CartSummary extends StatelessWidget {
  final CartController cart;

  const _CartSummary({required this.cart});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: StorefrontColors.surface,
        border: Border(top: BorderSide(color: Color(0xFFE7E3DC))),
      ),
      // This bar is pinned outside the scrollable cart list, so unlike
      // the rest of the screen it needs its own bottom safe-area inset --
      // Scaffold.body doesn't add one automatically the way
      // bottomNavigationBar does, and without it the Checkout button sits
      // flush against the home indicator on notched phones.
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Total',
                      style: TextStyle(color: StorefrontColors.inkMuted),
                    ),
                    Text(
                      '₵${cart.total.toStringAsFixed(2)}',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              FilledButton(
                onPressed: () => context.push('/checkout'),
                child: const Text('Checkout'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
