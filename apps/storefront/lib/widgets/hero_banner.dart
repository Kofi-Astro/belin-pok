import 'package:flutter/material.dart';

import '../theme.dart';

/// The home screen's opening section -- without this, the page starts
/// straight into a search bar and a (possibly empty) grid, which reads as
/// unfinished rather than intentionally sparse. A deep-purple banner with
/// an orange accent badge gives the page a top before the products start.
class HeroBanner extends StatelessWidget {
  const HeroBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 44),
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 5,
                ),
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
              const Text(
                'Everyday essentials,\nbuilt to last.',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 34,
                  fontWeight: FontWeight.w800,
                  height: 1.15,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'Caps, tees, jackets, and more -- shop the full lineup below.',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.75),
                  fontSize: 15,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
