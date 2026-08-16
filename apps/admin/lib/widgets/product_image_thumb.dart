import 'package:flutter/material.dart';

import '../api_client.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';

/// An already-uploaded product photo: tap the star to make it the cover
/// photo, tap the × to remove it. The primary photo gets a filled gold
/// star badge so it's obvious which one shows up everywhere else.
class ProductImageThumb extends StatelessWidget {
  final ProductImage image;
  final ApiClient api;
  final VoidCallback onChanged;

  const ProductImageThumb({
    super.key,
    required this.image,
    required this.api,
    required this.onChanged,
  });

  Future<void> _setPrimary(BuildContext context) async {
    try {
      await api.setPrimaryImage(image.id);
      onChanged();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _delete(BuildContext context) async {
    try {
      await api.deleteProductImage(image.id);
      onChanged();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 120,
      height: 120,
      child: Stack(
        fit: StackFit.expand,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              color: const Color(0xFFEFEBE3),
              child: Image.network(
                image.publicUrl(AppConfig.supabaseUrl),
                fit: BoxFit.cover,
                loadingBuilder: (context, child, progress) => progress == null
                    ? child
                    : const Center(
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                errorBuilder: (context, error, stack) => const Icon(
                  Icons.broken_image_outlined,
                  color: AppColors.inkMuted,
                ),
              ),
            ),
          ),
          Positioned(
            top: 4,
            right: 4,
            child: _RoundIconButton(
              icon: Icons.close,
              tooltip: 'Remove photo',
              onTap: () => _delete(context),
            ),
          ),
          Positioned(
            bottom: 4,
            left: 4,
            child: _RoundIconButton(
              icon: image.isPrimary ? Icons.star : Icons.star_border,
              tooltip: image.isPrimary ? 'Cover photo' : 'Make cover photo',
              filled: image.isPrimary,
              onTap: image.isPrimary ? null : () => _setPrimary(context),
            ),
          ),
        ],
      ),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;
  final bool filled;

  const _RoundIconButton({
    required this.icon,
    required this.tooltip,
    this.onTap,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          padding: const EdgeInsets.all(5),
          decoration: BoxDecoration(
            color: filled
                ? AppColors.amber
                : Colors.black.withValues(alpha: 0.55),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 15, color: Colors.white),
        ),
      ),
    );
  }
}
