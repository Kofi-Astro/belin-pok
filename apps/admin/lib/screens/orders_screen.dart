import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';
import '../widgets/status_pill.dart';

/// Storefront orders (not POS sales -- see LogSaleScreen for those): a
/// "Needs Attention" section up top for orders the database can no
/// longer fully cover (see GET /orders/needs-attention's doc comment in
/// the backend for why that gap opens up), then every order, filterable
/// by status. Tapping one opens _OrderStatusDialog to advance it through
/// the fulfillment pipeline.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  final _api = ApiClient();
  List<Order> _orders = [];
  List<Customer> _customers = [];
  List<Order> _needsAttention = [];
  String? _statusFilter;
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
        _api.listOrders(status: _statusFilter),
        _api.listCustomers(),
        _api.ordersNeedingAttention(),
      ]);
      setState(() {
        _orders = results[0] as List<Order>;
        _customers = results[1] as List<Customer>;
        _needsAttention = results[2] as List<Order>;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      setState(() => _loading = false);
    }
  }

  String _customerName(String id) => _customers
      .firstWhere(
        (c) => c.id == id,
        orElse: () => Customer(
          id: id,
          fullName: 'Unknown',
          email: '',
          phone: null,
          customerType: '',
          status: '',
          businessName: null,
          notes: null,
          creditLimit: 0,
          outstandingBalance: 0,
          isWholesaleVerified: false,
        ),
      )
      .fullName;

  Future<void> _openStatusDialog(Order order) async {
    final updated = await showDialog<bool>(
      context: context,
      builder: (_) => _OrderStatusDialog(api: _api, order: order),
    );
    if (updated == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Orders'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: DropdownButton<String?>(
              value: _statusFilter,
              hint: const Text('All statuses'),
              items: [
                const DropdownMenuItem(
                  value: null,
                  child: Text('All statuses'),
                ),
                for (final s in kOrderStatuses)
                  DropdownMenuItem(value: s, child: Text(s)),
              ],
              onChanged: (v) {
                setState(() => _statusFilter = v);
                _load();
              },
            ),
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
          const SizedBox(width: 8),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text('Error: $_error'))
          : _orders.isEmpty && _needsAttention.isEmpty
          ? const EmptyState(
              icon: Icons.receipt_long_outlined,
              title: 'No orders yet',
              message: 'Orders placed by customers will show up here.',
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (_needsAttention.isNotEmpty) ...[
                  Row(
                    children: [
                      const Icon(Icons.error_outline, color: AppColors.danger),
                      const SizedBox(width: 8),
                      Text(
                        'Needs Attention (${_needsAttention.length})',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                  const Padding(
                    padding: EdgeInsets.only(top: 4, bottom: 12),
                    child: Text(
                      "Ordered online but there's no longer enough in "
                      'stock to cover it -- probably a walk-in sale that '
                      "wasn't logged. Check the shelf before promising it.",
                      style: TextStyle(color: AppColors.inkMuted, fontSize: 12),
                    ),
                  ),
                  for (final order in _needsAttention)
                    _orderCard(order, highlighted: true),
                  const SizedBox(height: 24),
                ],
                for (final order in _orders) _orderCard(order),
              ],
            ),
    );
  }

  Widget _orderCard(Order order, {bool highlighted = false}) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: highlighted ? AppColors.danger.withValues(alpha: 0.08) : null,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        title: Text(
          '${order.orderNumber} · ${_customerName(order.customerId)}',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '${order.orderType} · ₵${order.total.toStringAsFixed(2)} · ${order.items.length} item(s)',
          style: const TextStyle(color: AppColors.inkMuted),
        ),
        trailing: StatusPill(status: order.status),
        onTap: () => _openStatusDialog(order),
      ),
    );
  }
}

class _OrderStatusDialog extends StatefulWidget {
  final ApiClient api;
  final Order order;
  const _OrderStatusDialog({required this.api, required this.order});

  @override
  State<_OrderStatusDialog> createState() => _OrderStatusDialogState();
}

class _OrderStatusDialogState extends State<_OrderStatusDialog> {
  late String _status = widget.order.status;
  final _noteController = TextEditingController();
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.updateOrderStatus(
        widget.order.id,
        _status,
        note: _noteController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canWrite =
        context.watch<AuthController>().profile?.canManageOrders ?? false;
    return AlertDialog(
      title: Text('Order ${widget.order.orderNumber}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final item in widget.order.items)
            Text(
              '${item.quantity} × variant ${item.variantId.substring(0, 8)}  —  ₵${item.lineTotal.toStringAsFixed(2)}',
            ),
          const SizedBox(height: 16),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: AppColors.danger),
              ),
            ),
          DropdownButtonFormField<String>(
            initialValue: _status,
            decoration: const InputDecoration(labelText: 'Status'),
            items: [
              for (final s in kOrderStatuses)
                DropdownMenuItem(value: s, child: Text(s)),
            ],
            onChanged: canWrite ? (v) => setState(() => _status = v!) : null,
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _noteController,
            decoration: const InputDecoration(labelText: 'Note (optional)'),
            enabled: canWrite,
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Close'),
        ),
        if (canWrite)
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: const Text('Update status'),
          ),
      ],
    );
  }
}
