import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api_client.dart';
import '../theme.dart';

/// A tap-to-add-photo tile: pick a file, it uploads immediately (no
/// separate "save" step to forget), with its own progress/error state.
/// Deliberately upload-on-pick rather than stage-then-save -- one fewer
/// step for someone who isn't comfortable with software.
///
/// [upload] does the actual work, so the same tile serves both a
/// product's gallery (ApiClient.uploadProductImage) and the receive-stock
/// form, where there's no product yet (ApiClient.uploadIntakePhoto).
/// [previewBytes], when set, fills the tile with that photo -- tapping
/// again replaces it.
class ImageUploadZone extends StatefulWidget {
  final Future<void> Function(Uint8List bytes, String fileExtension) upload;
  final VoidCallback? onUploaded;
  final Uint8List? previewBytes;

  /// Falls back to the gallery/file picker wherever this source isn't
  /// supported (e.g. camera on a desktop build).
  final ImageSource source;
  final String label;
  final double width;
  final double height;

  const ImageUploadZone({
    super.key,
    required this.upload,
    this.onUploaded,
    this.previewBytes,
    this.source = ImageSource.gallery,
    this.label = 'Add Photo',
    this.width = 120,
    this.height = 120,
  });

  @override
  State<ImageUploadZone> createState() => _ImageUploadZoneState();
}

class _ImageUploadZoneState extends State<ImageUploadZone> {
  bool _uploading = false;
  String? _error;

  Future<void> _pickAndUpload() async {
    setState(() => _error = null);
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: picker.supportsImageSource(widget.source)
          ? widget.source
          : ImageSource.gallery,
      imageQuality: 88,
    );
    if (picked == null) return;

    setState(() => _uploading = true);
    try {
      final bytes = await picked.readAsBytes();
      final extension = picked.name.contains('.')
          ? picked.name.split('.').last.toLowerCase()
          : 'jpg';
      await widget.upload(bytes, extension);
      widget.onUploaded?.call();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'Could not upload that photo. Try again.');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = widget.previewBytes;
    return InkWell(
      onTap: _uploading ? null : _pickAndUpload,
      borderRadius: BorderRadius.circular(14),
      child: DottedBorderBox(
        child: SizedBox(
          width: widget.width,
          height: widget.height,
          child: _uploading
              ? const Center(
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  ),
                )
              : preview != null
              ? Image.memory(preview, fit: BoxFit.cover)
              : Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        widget.source == ImageSource.camera
                            ? Icons.photo_camera_outlined
                            : Icons.add_photo_alternate_outlined,
                        color: _error != null
                            ? AppColors.danger
                            : AppColors.navy.withValues(alpha: 0.55),
                        size: 28,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _error ?? widget.label,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: _error != null
                              ? AppColors.danger
                              : AppColors.inkMuted,
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

/// Plain dashed-border container -- Flutter has no built-in dashed border,
/// and pulling in a package for one rectangle isn't worth it.
class DottedBorderBox extends StatelessWidget {
  final Widget child;
  const DottedBorderBox({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashedBorderPainter(),
      child: ClipRRect(borderRadius: BorderRadius.circular(14), child: child),
    );
  }
}

class _DashedBorderPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(
      Offset.zero & size,
      const Radius.circular(14),
    );
    final paint = Paint()
      ..color = AppColors.navy.withValues(alpha: 0.3)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6;

    final path = Path()..addRRect(rrect);
    const dashWidth = 6.0;
    const dashGap = 4.0;
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        canvas.drawPath(
          metric.extractPath(distance, distance + dashWidth),
          paint,
        );
        distance += dashWidth + dashGap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
