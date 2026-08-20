import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

String _tierLabel(String tier) => switch (tier) {
  'retail' => 'Retail',
  'wholesale' => 'Wholesale',
  'pack' => 'Pack',
  _ => tier,
};

/// The auditing home base: gross revenue split by how it was sold, what's
/// moving, what's running low, and which wholesale accounts owe money and
/// for how long -- everything traceable back to an append-only ledger on
/// the backend (pos_sale_items, stock_movements, customer_credit_ledger).
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _api = ApiClient();
  Dashboard? _dashboard;
  bool _loading = true;
  String? _error;
  int _days = 30;

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
      final dashboard = await _api.getDashboard(days: _days);
      if (mounted) setState(() => _dashboard = dashboard);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _dashboard;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text('Error: $_error'))
          : d == null
          ? const SizedBox.shrink()
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Wrap(
                  spacing: 8,
                  children: [7, 30, 90]
                      .map(
                        (n) => ChoiceChip(
                          label: Text('Last $n days'),
                          selected: _days == n,
                          onSelected: (_) => setState(() {
                            _days = n;
                            _load();
                          }),
                        ),
                      )
                      .toList(),
                ),
                const SizedBox(height: 20),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final wide = constraints.maxWidth > 700;
                    final tiles = [
                      _StatTile(
                        label: 'Gross revenue',
                        value: '₵${d.grossRevenue.toStringAsFixed(2)}',
                        icon: Icons.payments,
                        color: AppColors.success,
                      ),
                      _StatTile(
                        label: 'Items sold',
                        value: '${d.itemsSold}',
                        icon: Icons.shopping_bag_outlined,
                        color: AppColors.navy,
                      ),
                      _StatTile(
                        label: 'Low stock',
                        value: '${d.lowStockCount}',
                        icon: Icons.warning_amber,
                        color: d.lowStockCount > 0 ? AppColors.warning : AppColors.inkMuted,
                      ),
                      _StatTile(
                        label: 'Outstanding credit',
                        value: '₵${d.totalOutstandingCredit.toStringAsFixed(2)}',
                        icon: Icons.account_balance_wallet_outlined,
                        color: d.totalOutstandingCredit > 0 ? AppColors.danger : AppColors.inkMuted,
                      ),
                      _StatTile(
                        label: 'Needs product details',
                        value: '${d.unidentifiedItemCount}',
                        icon: Icons.edit_note,
                        color: d.unidentifiedItemCount > 0 ? AppColors.warning : AppColors.inkMuted,
                      ),
                    ];
                    return wide
                        ? Row(children: [for (final t in tiles) Expanded(child: t)])
                        : Column(children: tiles);
                  },
                ),
                if (d.unidentifiedItemCount > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.warning.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.info_outline, size: 18, color: AppColors.warning),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${d.unidentifiedItemCount} quick-logged sale line(s) still need a product '
                              'attached -- open Log Sale, expand a sale, and tap "Identify".',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 28),
                Text('Revenue by sale type', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                if (d.revenueByTier.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text('No sales in this period.', style: TextStyle(color: AppColors.inkMuted)),
                  )
                else
                  Card(
                    child: Column(
                      children: [
                        for (final t in d.revenueByTier)
                          ListTile(
                            dense: true,
                            title: Text(_tierLabel(t.priceTier)),
                            subtitle: Text('${t.itemsSold} item(s)'),
                            trailing: Text(
                              '₵${t.revenue.toStringAsFixed(2)}',
                              style: const TextStyle(fontWeight: FontWeight.w800),
                            ),
                          ),
                      ],
                    ),
                  ),
                const SizedBox(height: 28),
                Text('Top sellers', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                if (d.topVariants.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text('No POS sales in this period.', style: TextStyle(color: AppColors.inkMuted)),
                  )
                else
                  Card(
                    child: Column(
                      children: [
                        for (final v in d.topVariants)
                          ListTile(
                            dense: true,
                            title: Text(
                              '${v.productName} (${v.size}${v.color != null ? ' · ${v.color}' : ''})',
                            ),
                            subtitle: Text('${v.unitsSold} unit(s)'),
                            trailing: Text(
                              '₵${v.revenue.toStringAsFixed(2)}',
                              style: const TextStyle(fontWeight: FontWeight.w800),
                            ),
                          ),
                      ],
                    ),
                  ),
                const SizedBox(height: 28),
                Text('Aged debtors', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                if (d.agedDebtors.isEmpty)
                  const EmptyState(
                    icon: Icons.check_circle_outline,
                    title: 'No outstanding credit',
                    message: 'Every wholesale account is paid up.',
                  )
                else
                  Card(
                    child: Column(
                      children: [
                        for (final debtor in d.agedDebtors)
                          ListTile(
                            dense: true,
                            title: Text(debtor.businessName?.isNotEmpty == true ? debtor.businessName! : debtor.customerName),
                            subtitle: Text(
                              debtor.daysOutstanding != null
                                  ? 'Outstanding ${debtor.daysOutstanding} day(s) · limit ₵${debtor.creditLimit.toStringAsFixed(2)}'
                                  : 'Limit ₵${debtor.creditLimit.toStringAsFixed(2)}',
                            ),
                            trailing: Text(
                              '₵${debtor.outstandingBalance.toStringAsFixed(2)}',
                              style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.danger),
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

class _StatTile extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;
  const _StatTile({required this.label, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.all(6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color),
            const SizedBox(height: 10),
            Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: color)),
            Text(label, style: const TextStyle(color: AppColors.inkMuted, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
