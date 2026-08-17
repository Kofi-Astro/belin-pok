import 'package:flutter/material.dart';

import '../api_client.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

const _paymentMethods = ['cash', 'mobile_money', 'card'];

String _paymentLabel(String method) => switch (method) {
  'cash' => 'Cash',
  'mobile_money' => 'Mobile Money',
  'card' => 'Card',
  _ => method,
};

class _CartLine {
  final Product product;
  final ProductVariant variant;
  int quantity;
  _CartLine({
    required this.product,
    required this.variant,
    required this.quantity,
  });

  double get unitPrice => variant.priceOverride ?? product.basePrice;
  double get lineTotal => unitPrice * quantity;
  String get label =>
      '${product.name} (${variant.size}${variant.color != null ? ' · ${variant.color}' : ''})';
}

/// A real register: build up a cart from several products (tap a photo,
/// pick the size/color, set a quantity), then check out once with one or
/// more payment methods covering the total. Deducts stock and records the
/// payment together as one transaction, so "today's sales" is a list of
/// actual receipts rather than disconnected stock-quantity edits.
class LogSaleScreen extends StatefulWidget {
  const LogSaleScreen({super.key});

  @override
  State<LogSaleScreen> createState() => _LogSaleScreenState();
}

class _LogSaleScreenState extends State<LogSaleScreen> {
  final _api = ApiClient();
  final _searchController = TextEditingController();

  List<Product> _quickPick = [];
  List<Product> _results = [];
  Product? _picking;
  ProductVariant? _pickVariant;
  int _pickQuantity = 1;
  bool _searching = false;
  bool _loadingProduct = false;
  String? _error;

  final List<_CartLine> _cart = [];

  List<PosSale> _todaySales = [];
  bool _loadingSales = true;

  @override
  void initState() {
    super.initState();
    _loadQuickPick();
    _loadTodaySales();
  }

  Future<void> _loadQuickPick() async {
    try {
      final products = await _api.listProducts(status: 'active');
      if (mounted) setState(() => _quickPick = products);
    } on ApiException {
      // Convenience only -- search still works if this fails.
    }
  }

  Future<void> _loadTodaySales() async {
    setState(() => _loadingSales = true);
    try {
      final sales = await _api.listPosSales(limit: 200);
      final now = DateTime.now();
      final today = sales.where((s) {
        final d = s.createdAt.toLocal();
        return d.year == now.year && d.month == now.month && d.day == now.day;
      }).toList();
      if (mounted) setState(() => _todaySales = today);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loadingSales = false);
    }
  }

  Future<void> _search(String query) async {
    if (query.trim().isEmpty) {
      setState(() => _results = []);
      return;
    }
    setState(() => _searching = true);
    try {
      final results = await _api.listProducts(
        search: query.trim(),
        status: 'active',
      );
      if (mounted) setState(() => _results = results);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _selectProduct(Product product) async {
    setState(() {
      _loadingProduct = true;
      _error = null;
    });
    try {
      final full = await _api.getProduct(product.id);
      if (mounted) {
        setState(() {
          _picking = full;
          _pickVariant = null;
          _pickQuantity = 1;
        });
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loadingProduct = false);
    }
  }

  void _cancelPicking() {
    setState(() {
      _picking = null;
      _pickVariant = null;
      _pickQuantity = 1;
      _results = [];
      _searchController.clear();
    });
  }

  void _addToCart() {
    final product = _picking;
    final variant = _pickVariant;
    if (product == null || variant == null) return;

    setState(() {
      final existing = _cart.where((l) => l.variant.id == variant.id).firstOrNull;
      if (existing != null) {
        existing.quantity = (existing.quantity + _pickQuantity).clamp(
          1,
          variant.stockQuantity,
        );
      } else {
        _cart.add(
          _CartLine(product: product, variant: variant, quantity: _pickQuantity),
        );
      }
    });
    _cancelPicking();
  }

  double get _cartTotal => _cart.fold(0, (sum, l) => sum + l.lineTotal);

  Future<void> _openCheckout() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (_) => _CheckoutDialog(api: _api, cart: _cart, total: _cartTotal),
    );
    if (result == true) {
      setState(() => _cart.clear());
      _loadTodaySales();
    }
  }

  Future<void> _voidSale(PosSale sale) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Void this sale?'),
        content: Text(
          'This puts every item back in stock and removes '
          '₵${sale.total.toStringAsFixed(2)} from today\'s total. For '
          "fixing a mistake, not a customer return.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Void sale'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await _api.voidPosSale(sale.id);
      _loadTodaySales();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final activeSales = _todaySales.where((s) => !s.isVoided).toList();
    final todayTotal = activeSales.fold<double>(0, (sum, s) => sum + s.total);
    final todayItemCount = activeSales.fold<int>(
      0,
      (sum, s) => sum + s.items.fold<int>(0, (n, i) => n + i.quantity),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Log a Sale')),
      floatingActionButton: _cart.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: _openCheckout,
              icon: const Icon(Icons.point_of_sale),
              label: Text('Checkout · ₵${_cartTotal.toStringAsFixed(2)}'),
            ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 100),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                _error!,
                style: const TextStyle(color: AppColors.danger),
              ),
            ),

          if (_cart.isNotEmpty) ...[
            Text(
              'Cart',
              style: Theme.of(
                context,
              ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            for (final line in _cart) _CartTile(
              line: line,
              onRemove: () => setState(() => _cart.remove(line)),
              onQuantityChanged: (q) => setState(() => line.quantity = q),
            ),
            const SizedBox(height: 20),
          ],

          if (_picking == null) ...[
            if (_quickPick.isNotEmpty) ...[
              Text(
                'Quick pick',
                style: Theme.of(
                  context,
                ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 128,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _quickPick.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 10),
                  itemBuilder: (context, index) => _QuickPickCard(
                    product: _quickPick[index],
                    onTap: () => _selectProduct(_quickPick[index]),
                  ),
                ),
              ),
              const SizedBox(height: 20),
            ],
            TextField(
              controller: _searchController,
              decoration: InputDecoration(
                labelText: 'Or search by name',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searching
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : null,
              ),
              onChanged: _search,
            ),
            const SizedBox(height: 12),
            if (_loadingProduct) const Center(child: CircularProgressIndicator()),
            for (final product in _results)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: _Thumb(product: product),
                  title: Text(product.name),
                  subtitle: Text('₵${product.basePrice.toStringAsFixed(2)}'),
                  onTap: () => _selectProduct(product),
                ),
              ),
          ] else
            _VariantPickForm(
              product: _picking!,
              variant: _pickVariant,
              quantity: _pickQuantity,
              onVariantChanged: (v) => setState(() {
                _pickVariant = v;
                _pickQuantity = 1;
              }),
              onQuantityChanged: (q) => setState(() => _pickQuantity = q),
              onCancel: _cancelPicking,
              onAddToCart: _addToCart,
            ),

          const SizedBox(height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Today's Sales",
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              Text(
                '$todayItemCount item(s) · ₵${todayTotal.toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_loadingSales)
            const Center(child: CircularProgressIndicator())
          else if (_todaySales.isEmpty)
            const EmptyState(
              icon: Icons.point_of_sale_outlined,
              title: 'No sales logged today yet',
              message: 'Whatever you check out above will show up here.',
            )
          else
            for (final sale in _todaySales)
              _SaleCard(sale: sale, onVoid: () => _voidSale(sale)),
        ],
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  final Product product;
  const _Thumb({required this.product});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        width: 44,
        height: 44,
        child: product.primaryImage == null
            ? Container(
                color: const Color(0xFFEFEBE3),
                child: const Icon(
                  Icons.checkroom_outlined,
                  color: AppColors.inkMuted,
                ),
              )
            : Image.network(
                product.primaryImage!.publicUrl(AppConfig.supabaseUrl),
                fit: BoxFit.cover,
                errorBuilder: (context, error, stack) =>
                    const Icon(Icons.broken_image_outlined),
              ),
      ),
    );
  }
}

class _QuickPickCard extends StatelessWidget {
  final Product product;
  final VoidCallback onTap;
  const _QuickPickCard({required this.product, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 96,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.navy.withValues(alpha: 0.12)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 80,
                height: 60,
                child: product.primaryImage == null
                    ? Container(
                        color: const Color(0xFFEFEBE3),
                        child: const Icon(
                          Icons.checkroom_outlined,
                          color: AppColors.inkMuted,
                        ),
                      )
                    : Image.network(
                        product.primaryImage!.publicUrl(
                          AppConfig.supabaseUrl,
                        ),
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stack) =>
                            const Icon(Icons.broken_image_outlined),
                      ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              product.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
            ),
            Text(
              '₵${product.basePrice.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 11, color: AppColors.inkMuted),
            ),
          ],
        ),
      ),
    );
  }
}

class _CartTile extends StatelessWidget {
  final _CartLine line;
  final VoidCallback onRemove;
  final ValueChanged<int> onQuantityChanged;

  const _CartTile({
    required this.line,
    required this.onRemove,
    required this.onQuantityChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text(line.label, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text('₵${line.unitPrice.toStringAsFixed(2)} each'),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.remove_circle_outline, size: 20),
              onPressed: line.quantity > 1
                  ? () => onQuantityChanged(line.quantity - 1)
                  : null,
            ),
            Text('${line.quantity}', style: const TextStyle(fontWeight: FontWeight.w700)),
            IconButton(
              icon: const Icon(Icons.add_circle_outline, size: 20),
              onPressed: line.quantity < line.variant.stockQuantity
                  ? () => onQuantityChanged(line.quantity + 1)
                  : null,
            ),
            const SizedBox(width: 8),
            Text(
              '₵${line.lineTotal.toStringAsFixed(2)}',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.danger),
              onPressed: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}

class _VariantPickForm extends StatelessWidget {
  final Product product;
  final ProductVariant? variant;
  final int quantity;
  final ValueChanged<ProductVariant> onVariantChanged;
  final ValueChanged<int> onQuantityChanged;
  final VoidCallback onCancel;
  final VoidCallback onAddToCart;

  const _VariantPickForm({
    required this.product,
    required this.variant,
    required this.quantity,
    required this.onVariantChanged,
    required this.onQuantityChanged,
    required this.onCancel,
    required this.onAddToCart,
  });

  @override
  Widget build(BuildContext context) {
    final unitPrice = variant?.priceOverride ?? product.basePrice;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    product.name,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: 'Search for a different item',
                  onPressed: onCancel,
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              'Size / color',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            if (product.variants.isEmpty)
              const Text(
                'This product has no sizes/colors set up yet.',
                style: TextStyle(color: AppColors.inkMuted),
              ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final v in product.variants)
                  ChoiceChip(
                    label: Text(
                      '${v.size}${v.color != null ? ' · ${v.color}' : ''}'
                      '${v.stockQuantity <= 0 ? ' (out of stock)' : ''}',
                    ),
                    selected: variant?.id == v.id,
                    onSelected: v.stockQuantity <= 0
                        ? null
                        : (_) => onVariantChanged(v),
                  ),
              ],
            ),
            if (variant != null) ...[
              const SizedBox(height: 20),
              Text('Quantity', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              Row(
                children: [
                  IconButton.filledTonal(
                    icon: const Icon(Icons.remove),
                    onPressed: quantity > 1
                        ? () => onQuantityChanged(quantity - 1)
                        : null,
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Text(
                      '$quantity',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton.filledTonal(
                    icon: const Icon(Icons.add),
                    onPressed: quantity < variant!.stockQuantity
                        ? () => onQuantityChanged(quantity + 1)
                        : null,
                  ),
                  const Spacer(),
                  Text(
                    '₵${(unitPrice * quantity).toStringAsFixed(2)}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 18,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: onAddToCart,
                icon: const Icon(Icons.add_shopping_cart),
                label: const Text('Add to Cart'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SaleCard extends StatelessWidget {
  final PosSale sale;
  final VoidCallback onVoid;

  const _SaleCard({required this.sale, required this.onVoid});

  @override
  Widget build(BuildContext context) {
    final time = sale.createdAt.toLocal();
    final timeLabel =
        '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
    final paymentSummary = sale.payments
        .map((p) => _paymentLabel(p.method))
        .toSet()
        .join(' + ');

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: sale.isVoided ? AppColors.inkMuted.withValues(alpha: 0.06) : null,
      child: ExpansionTile(
        title: Text(
          '${sale.items.fold<int>(0, (n, i) => n + i.quantity)} item(s) · '
          '₵${sale.total.toStringAsFixed(2)} · $paymentSummary',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            decoration: sale.isVoided ? TextDecoration.lineThrough : null,
            color: sale.isVoided ? AppColors.inkMuted : null,
          ),
        ),
        subtitle: Text(
          [
            if (sale.staffName != null) sale.staffName!,
            if (sale.customerName != null) sale.customerName!,
            timeLabel,
            if (sale.isVoided) 'Voided',
          ].join(' · '),
        ),
        trailing: sale.isVoided
            ? const Icon(Icons.undo, color: AppColors.inkMuted)
            : IconButton(
                icon: const Icon(Icons.undo, size: 18),
                tooltip: 'Void this sale',
                onPressed: onVoid,
              ),
        children: [
          for (final item in sale.items)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Row(
                children: [
                  Expanded(child: Text('${item.quantity} × ${item.label}')),
                  Text('₵${item.lineTotal.toStringAsFixed(2)}'),
                ],
              ),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _CheckoutDialog extends StatefulWidget {
  final ApiClient api;
  final List<_CartLine> cart;
  final double total;

  const _CheckoutDialog({
    required this.api,
    required this.cart,
    required this.total,
  });

  @override
  State<_CheckoutDialog> createState() => _CheckoutDialogState();
}

class _Payment {
  String method;
  final TextEditingController controller;
  _Payment(this.method, double amount)
    : controller = TextEditingController(text: amount.toStringAsFixed(2));
}

class _CheckoutDialogState extends State<_CheckoutDialog> {
  late final List<_Payment> _payments = [_Payment('cash', widget.total)];
  bool _submitting = false;
  String? _error;

  double get _paid => _payments.fold(
    0,
    (sum, p) => sum + (double.tryParse(p.controller.text) ?? 0),
  );

  double get _remaining => widget.total - _paid;

  void _addPaymentLine() {
    setState(() => _payments.add(_Payment('cash', _remaining.clamp(0, widget.total))));
  }

  Future<void> _submit() async {
    if (_remaining.abs() > 0.01) {
      setState(() => _error = "Payments don't add up to the total yet");
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.createPosSale(
        items: [
          for (final line in widget.cart)
            {'variant_id': line.variant.id, 'quantity': line.quantity},
        ],
        payments: [
          for (final p in _payments)
            {'method': p.method, 'amount': double.tryParse(p.controller.text) ?? 0},
        ],
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    for (final p in _payments) {
      p.controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Checkout'),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Total: ₵${widget.total.toStringAsFixed(2)}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger),
                ),
              ),
            for (final p in _payments)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: p.method,
                        decoration: const InputDecoration(labelText: 'Method'),
                        items: _paymentMethods
                            .map(
                              (m) => DropdownMenuItem(
                                value: m,
                                child: Text(_paymentLabel(m)),
                              ),
                            )
                            .toList(),
                        onChanged: (v) => setState(() => p.method = v!),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: p.controller,
                        decoration: const InputDecoration(labelText: 'Amount (₵)'),
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                    if (_payments.length > 1)
                      IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () => setState(() => _payments.remove(p)),
                      ),
                  ],
                ),
              ),
            TextButton.icon(
              onPressed: _addPaymentLine,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Split into another payment method'),
            ),
            const SizedBox(height: 8),
            Text(
              _remaining.abs() < 0.01
                  ? 'Fully covered'
                  : _remaining > 0
                  ? 'Remaining: ₵${_remaining.toStringAsFixed(2)}'
                  : 'Over by ₵${(-_remaining).toStringAsFixed(2)}',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: _remaining.abs() < 0.01
                    ? AppColors.success
                    : AppColors.danger,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Complete Sale'),
        ),
      ],
    );
  }
}
