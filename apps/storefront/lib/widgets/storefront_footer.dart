import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';

import '../theme.dart';
import 'responsive.dart';

class StorefrontFooter extends StatelessWidget {
  final List<Category> categories;
  final ValueChanged<String> onCategoryTap;

  const StorefrontFooter({
    super.key,
    required this.categories,
    required this.onCategoryTap,
  });

  @override
  Widget build(BuildContext context) {
    final wide = isWideScreen(context);
    return Container(
      width: double.infinity,
      color: StorefrontColors.deepPurple,
      padding: EdgeInsets.symmetric(horizontal: 24, vertical: wide ? 48 : 32),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1200),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              wide ? _buildWideColumns(context) : _buildNarrowColumns(context),
              const SizedBox(height: 28),
              Divider(color: Colors.white.withValues(alpha: 0.15)),
              const SizedBox(height: 12),
              Text(
                '© ${DateTime.now().year} Belin-Pok Enterprise',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.5),
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildWideColumns(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(flex: 2, child: _brandColumn()),
        Expanded(child: _shopColumn()),
        Expanded(child: _helpColumn()),
      ],
    );
  }

  Widget _buildNarrowColumns(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _brandColumn(),
        const SizedBox(height: 28),
        _shopColumn(),
        const SizedBox(height: 24),
        _helpColumn(),
      ],
    );
  }

  Widget _brandColumn() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text(
          'Belin-Pok Enterprise',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w800,
            fontSize: 18,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Caps, t-shirts, jackets, sweatshirts, and everyday essentials.',
          style: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
        ),
      ],
    );
  }

  Widget _shopColumn() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _columnHeading('Shop'),
        const SizedBox(height: 10),
        ...categories.map(
          (category) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _footerLink(category.name, () => onCategoryTap(category.id)),
          ),
        ),
      ],
    );
  }

  Widget _helpColumn() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _columnHeading('Ordering'),
        const SizedBox(height: 10),
        _footerText('Delivery across Ghana, or pick up in-store'),
        const SizedBox(height: 8),
        _footerText(
          'Pay on delivery or pickup -- online payment is coming soon',
        ),
      ],
    );
  }

  Widget _columnHeading(String text) => Text(
    text,
    style: const TextStyle(
      color: Colors.white,
      fontWeight: FontWeight.w800,
      fontSize: 13,
    ),
  );

  Widget _footerLink(String text, VoidCallback onTap) => InkWell(
    onTap: onTap,
    child: Text(
      text,
      style: TextStyle(
        color: Colors.white.withValues(alpha: 0.7),
        fontSize: 13.5,
      ),
    ),
  );

  Widget _footerText(String text) => Text(
    text,
    style: TextStyle(
      color: Colors.white.withValues(alpha: 0.7),
      fontSize: 13.5,
    ),
  );
}
