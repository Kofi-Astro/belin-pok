import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
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
  List<DailySales> _dailySales = [];
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
    // Revenue is a manager-level view -- the backend only allows
    // owner/inventory_manager to call this, so skip it entirely for
    // everyone else rather than let it 403 in the background.
    final canViewSales =
        context.read<AuthController>().profile?.canManageInventory ?? false;
    try {
      final results = await Future.wait([
        _api.lowStockVariants(),
        _api.listStockMovements(),
        if (canViewSales) _api.dailySales(days: 14) else Future.value(<DailySales>[]),
      ]);
      setState(() {
        _lowStock = results[0] as List<LowStockVariant>;
        _recentMovements = results[1] as List<StockMovement>;
        _dailySales = results[2] as List<DailySales>;
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
                if (_dailySales.isNotEmpty) ...[
                  Text(
                    'Sales',
                    style: Theme.of(
                      context,
                    ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 12),
                  _TodaySalesCard(sales: _dailySales),
                  const SizedBox(height: 16),
                  for (final day in _dailySales)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        dense: true,
                        title: Text(_formatDay(day.day)),
                        subtitle: Text('${day.itemsSold} item(s) sold'),
                        trailing: Text(
                          '₵${day.totalAmount.toStringAsFixed(2)}',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                  const SizedBox(height: 32),
                ],
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
                    color: m.isFloorSale
                        ? AppColors.amber.withValues(alpha: 0.08)
                        : null,
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
                        m.productName != null
                            ? '${m.productName} '
                                  '(${m.variantSize}${m.variantColor != null ? ' · ${m.variantColor}' : ''}) · '
                                  '${m.quantityChange > 0 ? '+' : ''}${m.quantityChange}'
                            : '${m.movementType[0].toUpperCase()}${m.movementType.substring(1)} · '
                                  '${m.quantityChange > 0 ? '+' : ''}${m.quantityChange}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text(
                        [
                          if (m.isFloorSale)
                            'Walk-in sale · ${m.performedByName ?? 'Staff'}'
                          else if (m.performedByName != null)
                            m.performedByName!,
                          if (m.reason?.isNotEmpty == true) m.reason!,
                          _formatDate(m.createdAt),
                        ].join(' · '),
                      ),
                      trailing: m.isFloorSale
                          ? const Icon(
                              Icons.storefront_outlined,
                              color: AppColors.amber,
                            )
                          : null,
                    ),
                  ),
              ],
            ),
    );
  }

  String _formatDate(DateTime dt) =>
      '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} '
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';

  static const _monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  String _formatDay(DateTime day) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final that = DateTime(day.year, day.month, day.day);
    final diff = today.difference(that).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    return '${_monthNames[day.month - 1]} ${day.day}, ${day.year}';
  }
}

/// Highlights today's total prominently -- the day-by-day list below still
/// has it, but a manager glancing at this screen mid-shift shouldn't have
/// to scan a list to find "how much have we made today".
class _TodaySalesCard extends StatelessWidget {
  final List<DailySales> sales;
  const _TodaySalesCard({required this.sales});

  DailySales? _findToday() {
    final now = DateTime.now();
    for (final d in sales) {
      if (d.day.year == now.year &&
          d.day.month == now.month &&
          d.day.day == now.day) {
        return d;
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final today = _findToday();
    return Card(
      color: AppColors.navy,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    "Today's Sales",
                    style: TextStyle(
                      color: Colors.white70,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '₵${(today?.totalAmount ?? 0).toStringAsFixed(2)}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 28,
                    ),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Text(
                  'Items sold',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
                Text(
                  '${today?.itemsSold ?? 0}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 20,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
