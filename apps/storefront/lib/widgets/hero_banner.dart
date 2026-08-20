import 'package:flutter/material.dart';

import '../theme.dart';
import 'responsive.dart';

/// The home screen's opening section. Redesigned around two patterns
/// real storefronts lean on: a CTA that lives inside the hero itself
/// (visible with zero scrolling, paired with a softer secondary link)
/// rather than a headline with nothing to press, and -- since there's no
/// product photography yet to anchor a lifestyle shot -- an abstract
/// layered-icon graphic on wide screens instead of leaving that space
/// empty. Narrow screens drop the graphic entirely rather than shrinking
/// it into irrelevance.
class HeroBanner extends StatelessWidget {
  final VoidCallback onShopNow;

  const HeroBanner({super.key, required this.onShopNow});

  @override
  Widget build(BuildContext context) {
    final wide = isWideScreen(context);
    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(horizontal: 24, vertical: wide ? 72 : 44),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            StorefrontColors.deepPurple,
            StorefrontColors.deepPurpleLight,
          ],
        ),
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1200),
          child: wide
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      flex: 3,
                      child: _HeroCopy(wide: true, onShopNow: onShopNow),
                    ),
                    const SizedBox(width: 48),
                    const Expanded(flex: 2, child: _HeroGraphic()),
                  ],
                )
              : _HeroCopy(wide: false, onShopNow: onShopNow),
        ),
      ),
    );
  }
}

class _HeroCopy extends StatelessWidget {
  final bool wide;
  final VoidCallback onShopNow;

  const _HeroCopy({required this.wide, required this.onShopNow});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(
            color: StorefrontColors.deepOrange,
            borderRadius: BorderRadius.circular(20),
          ),
          child: const Text(
            'BELIN-POK ENTERPRISE',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 11,
              letterSpacing: 1.1,
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          'Everyday essentials,\nbuilt to last.',
          style: TextStyle(
            color: Colors.white,
            fontSize: wide ? 46 : 34,
            fontWeight: FontWeight.w800,
            height: 1.12,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Caps, tees, jackets, and more -- shop the full lineup below.',
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.78),
            fontSize: wide ? 17 : 15,
          ),
        ),
        const SizedBox(height: 26),
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 20,
          runSpacing: 12,
          children: [
            FilledButton(
              onPressed: onShopNow,
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: StorefrontColors.deepPurple,
              ),
              child: const Text('Shop the collection'),
            ),
            TextButton(
              onPressed: onShopNow,
              style: TextButton.styleFrom(foregroundColor: Colors.white),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'See what\'s new',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  SizedBox(width: 4),
                  Icon(Icons.arrow_forward, size: 16),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// A layered-circle composition standing in for lifestyle photography --
/// three icon "bubbles" (a jacket, a cap, a tee) over a soft translucent
/// disc, web-only since it needs the room a narrow phone screen doesn't
/// have to spare above the fold.
class _HeroGraphic extends StatelessWidget {
  const _HeroGraphic();

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.white.withValues(alpha: 0.08),
            ),
          ),
          Positioned(
            top: 16,
            left: 8,
            child: _bubble(Icons.checkroom, StorefrontColors.deepOrange, 66),
          ),
          Positioned(
            bottom: 24,
            right: 0,
            child: _bubble(Icons.sports_baseball, StorefrontColors.gold, 58),
          ),
          _bubble(
            Icons.dry_cleaning,
            Colors.white,
            96,
            iconColor: StorefrontColors.deepPurple,
          ),
        ],
      ),
    );
  }

  Widget _bubble(
    IconData icon,
    Color background,
    double size, {
    Color? iconColor,
  }) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: background,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Icon(icon, color: iconColor ?? Colors.white, size: size * 0.44),
    );
  }
}
