import 'package:flutter/material.dart';

import '../theme.dart';

const Map<String, Color> _statusColors = {
  'draft': AppColors.inkMuted,
  'active': AppColors.success,
  'archived': AppColors.danger,
  'pending': AppColors.warning,
  'paid': AppColors.success,
  'packed': AppColors.navyLight,
  'shipped': AppColors.navyLight,
  'delivered': AppColors.success,
  'cancelled': AppColors.danger,
  'refunded': AppColors.danger,
  'approved': AppColors.success,
  'rejected': AppColors.danger,
};

/// A small colored capsule for status text (product/order/customer status)
/// -- meant to be recognizable at a glance without reading, since not every
/// user will know what "packed" vs "shipped" means at first.
class StatusPill extends StatelessWidget {
  final String status;
  const StatusPill({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final color = _statusColors[status] ?? AppColors.inkMuted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        status[0].toUpperCase() + status.substring(1),
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
      ),
    );
  }
}
