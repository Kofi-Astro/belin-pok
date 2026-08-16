import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';
import '../widgets/stock_movement_dialog.dart';

class InventoryScreen extends StatefulWidget {
  const InventoryScreen({super.key});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  final _api = ApiClient();
  List<ProductVariant> _lowStock = [];
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
        _lowStock = results[0] as List<ProductVariant>;
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
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    const Icon(Icons.warning_amber, color: Colors.orange),
                    const SizedBox(width: 8),
                    Text(
                      'Low stock (${_lowStock.length})',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (_lowStock.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(8),
                    child: Text('Nothing is low on stock.'),
                  ),
                for (final v in _lowStock)
                  Card(
                    child: ListTile(
                      title: Text(
                        '${v.sku} · ${v.size}${v.color != null ? ' · ${v.color}' : ''}',
                      ),
                      subtitle: Text(
                        'Stock: ${v.stockQuantity} (threshold ${v.lowStockThreshold})',
                      ),
                      trailing: FilledButton(
                        onPressed: () => _adjustStock(v),
                        child: const Text('Restock'),
                      ),
                    ),
                  ),
                const SizedBox(height: 32),
                Text(
                  'Recent stock movements',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                if (_recentMovements.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(8),
                    child: Text('No movements logged yet.'),
                  ),
                for (final m in _recentMovements)
                  ListTile(
                    dense: true,
                    leading: Icon(
                      m.quantityChange >= 0
                          ? Icons.arrow_upward
                          : Icons.arrow_downward,
                      color: m.quantityChange >= 0 ? Colors.green : Colors.red,
                    ),
                    title: Text(
                      '${m.movementType} · ${m.quantityChange > 0 ? '+' : ''}${m.quantityChange}',
                    ),
                    subtitle: Text(
                      m.reason?.isNotEmpty == true
                          ? m.reason!
                          : m.createdAt.toString(),
                    ),
                  ),
              ],
            ),
    );
  }
}
