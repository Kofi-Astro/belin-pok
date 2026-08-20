import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';

import '../config.dart';
import '../theme.dart';

class ProductCard extends StatefulWidget {
  final Product product;
  final VoidCallback onTap;

  const ProductCard({super.key, required this.product, required this.onTap});

  @override
  State<ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<ProductCard> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    final image = product.primaryImage;
    return MouseRegion(
      onEnter: (_) => setState(() => _hovering = true),
      onExit: (_) => setState(() => _hovering = false),
      cursor: SystemMouseCursors.click,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        curve: Curves.easeOut,
        transform: Matrix4.translationValues(0, _hovering ? -4 : 0, 0),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          boxShadow: _hovering
              ? [
                  BoxShadow(
                    color: StorefrontColors.deepPurple.withValues(alpha: 0.16),
                    blurRadius: 20,
                    offset: const Offset(0, 10),
                  ),
                ]
              : const [],
        ),
        child: Card(
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: widget.onTap,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AspectRatio(
                  aspectRatio: 1,
                  child: image != null
                      ? Image.network(
                          image.publicUrl(AppConfig.supabaseUrl),
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) =>
                              const _PlaceholderImage(),
                        )
                      : const _PlaceholderImage(),
                ),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        product.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '₵${product.basePrice.toStringAsFixed(2)}',
                        style: const TextStyle(
                          color: StorefrontColors.deepPurple,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PlaceholderImage extends StatelessWidget {
  const _PlaceholderImage();

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          StorefrontColors.canvas,
          StorefrontColors.deepPurple.withValues(alpha: 0.06),
        ],
      ),
    ),
    alignment: Alignment.center,
    child: Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: StorefrontColors.deepPurple.withValues(alpha: 0.06),
        shape: BoxShape.circle,
      ),
      child: Icon(
        Icons.checkroom,
        size: 32,
        color: StorefrontColors.deepPurple.withValues(alpha: 0.45),
      ),
    ),
  );
}
