import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';

class StorefrontFooter extends StatelessWidget {
  const StorefrontFooter({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppColors.navy,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1200),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
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
              const SizedBox(height: 20),
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
}
