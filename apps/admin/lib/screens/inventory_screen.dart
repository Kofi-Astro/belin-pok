import 'package:flutter/material.dart';

import '../api_client.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';
import '../widgets/stock_movement_dialog.dart';

class InventoryScreen extends StatefulWidget {
  const InventoryScreen({super.key});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  final _api = ApiClient();
  List<LowStockVariant> _lowStock = [];
  List<StockMovement> _recentMovements = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _api.lowStockVariants(),
        _api.listStockMovements(),
      ]);
      setState(() {
        _lowStock = results[0] as List<LowStockVariant>;
        _recentMovements = results[1] as List<StockMovement>;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _adjustStock(ProductVariant variant) async {
    final adjusted = await showDialog<bool>(
      context: context,
      builder: (_) => StockMovementDialog(api: _api, variant: variant),
    );
    if (adjusted == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Inventory'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text('Error: $_error'))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.warning_amber_rounded,
                      color: AppColors.warning,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Running Low (${_lowStock.length})',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (_lowStock.isEmpty)
                  const EmptyState(
                    icon: Icons.check_circle_outline,
                    title: 'Nothing is low on stock',
                    message:
                        'Everything is above its restock threshold right now.',
                  ),
                for (final entry in _lowStock)
                  Card(
                    margin: const EdgeInsets.only(bottom: 10),
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              width: 56,
                              height: 56,
                              color: const Color(0xFFEFEBE3),
                              child:
                                  entry.publicImageUrl(AppConfig.supabaseUrl) ==
                                      null
                                  ? const Icon(
                                      Icons.checkroom_outlined,
                                      color: AppColors.inkMuted,
                                    )
                                  : Image.network(
                                      entry.publicImageUrl(
                                        AppConfig.supabaseUrl,
                                      )!,
                                      fit: BoxFit.cover,
                                      errorBuilder: (context, error, stack) =>
                                          const Icon(
                                            Icons.broken_image_outlined,
                                            color: AppColors.inkMuted,
                                          ),
                                    ),
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  entry.productName,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  '${entry.variant.size}${entry.variant.color != null ? ' · ${entry.variant.color}' : ''}'
                                  ' · Only ${entry.variant.stockQuantity} left',
                                  style: const TextStyle(
                                    color: AppColors.danger,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          FilledButton(
                            onPressed: () => _adjustStock(entry.variant),
                            child: const Text('Restock'),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 32),
                Text(
                  'Recent Activity',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 12),
                if (_recentMovements.isEmpty)
                  const EmptyState(
                    icon: Icons.history,
                    title: 'No activity yet',
                    message:
                        'Restocks, sales, and corrections will show up here.',
                  ),
                for (final m in _recentMovements)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor:
                            (m.quantityChange >= 0
                                    ? AppColors.success
                                    : AppColors.danger)
                                .withValues(alpha: 0.12),
                        child: Icon(
                          m.quantityChange >= 0
                              ? Icons.arrow_upward
                              : Icons.arrow_downward,
                          color: m.quantityChange >= 0
                              ? AppColors.success
                              : AppColors.danger,
                        ),
                      ),
                      title: Text(
                        '${m.movementType[0].toUpperCase()}${m.movementType.substring(1)} · '
                        '${m.quantityChange > 0 ? '+' : ''}${m.quantityChange}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text(
                        m.reason?.isNotEmpty == true
                            ? m.reason!
                            : _formatDate(m.createdAt),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }

  String _formatDate(DateTime dt) =>
      '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} '
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}
