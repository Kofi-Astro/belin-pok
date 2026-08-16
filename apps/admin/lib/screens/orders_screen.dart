import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../models.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  final _api = ApiClient();
  List<Order> _orders = [];
  List<Customer> _customers = [];
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
      ]);
      setState(() {
        _orders = results[0] as List<Order>;
        _customers = results[1] as List<Customer>;
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
          customerType: '',
          status: '',
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
          : _orders.isEmpty
          ? const Center(child: Text('No orders yet.'))
          : ListView.separated(
              itemCount: _orders.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final order = _orders[index];
                return ListTile(
                  title: Text(
                    '${order.orderNumber} · ${_customerName(order.customerId)}',
                  ),
                  subtitle: Text(
                    '${order.orderType} · \$${order.total.toStringAsFixed(2)} · ${order.items.length} item(s)',
                  ),
                  trailing: Chip(label: Text(order.status)),
                  onTap: () => _openStatusDialog(order),
                );
              },
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
              '${item.quantity} × variant ${item.variantId.substring(0, 8)}  —  \$${item.lineTotal.toStringAsFixed(2)}',
            ),
          const SizedBox(height: 16),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
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
