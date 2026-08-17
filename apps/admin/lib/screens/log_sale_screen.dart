import 'package:flutter/material.dart';

import '../api_client.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

/// One-item-at-a-time entry for an in-person sale: tap a product from the
/// quick-pick strip (or search for one further down the list), pick the
/// size/color sold, say how many, record it. Deducts stock the moment
/// it's recorded (same stock-movements mechanism as everywhere else) and
/// resets straight back to search so the next item can be logged without
/// any extra navigation. Today's sales are listed below with price and a
/// way to void a mistaken entry.
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
  Product? _selected;
  ProductVariant? _variant;
  int _quantity = 1;
  bool _searching = false;
  bool _loadingProduct = false;
  bool _submitting = false;
  String? _error;

  List<StockMovement> _todaySales = [];
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
      // Quick-pick is a convenience, not core to the screen -- search still
      // works if this fails, so there's nothing to show the user here.
    }
  }

  Future<void> _loadTodaySales() async {
    setState(() => _loadingSales = true);
    try {
      final movements = await _api.listStockMovements(limit: 200);
      final now = DateTime.now();
      final today = movements.where((m) {
        final d = m.createdAt.toLocal();
        return m.movementType == 'sale' &&
            d.year == now.year &&
            d.month == now.month &&
            d.day == now.day;
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
          _selected = full;
          _variant = null;
          _quantity = 1;
        });
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loadingProduct = false);
    }
  }

  void _reset() {
    setState(() {
      _selected = null;
      _variant = null;
      _quantity = 1;
      _results = [];
      _error = null;
      _searchController.clear();
    });
  }

  Future<void> _recordSale() async {
    final variant = _variant;
    final product = _selected;
    if (variant == null || product == null) return;

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await _api.createStockMovement(
        variantId: variant.id,
        movementType: 'sale',
        quantityChange: -_quantity,
      );
      if (mounted) {
        final label =
            '${product.name} (${variant.size}'
            '${variant.color != null ? ' · ${variant.color}' : ''})';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Recorded: $_quantity × $label')),
        );
        _reset();
        _loadTodaySales();
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _voidSale(StockMovement sale) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Void this sale?'),
        content: Text(
          'This puts ${sale.quantityChange.abs()} × ${sale.itemLabel} back '
          "in stock and removes it from today's total. For fixing a "
          "mistake, not a customer return.",
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
      await _api.createStockMovement(
        variantId: sale.variantId,
        movementType: 'sale',
        quantityChange: -sale.quantityChange,
        reason: 'Correction: voided sale entry',
        referenceType: 'void',
        referenceId: sale.id,
      );
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
    final voidedIds = _todaySales
        .where((m) => m.referenceType == 'void' && m.referenceId != null)
        .map((m) => m.referenceId!)
        .toSet();
    final sold = _todaySales.where((m) => m.quantityChange < 0).toList();
    final todayTotal = _todaySales.fold<double>(
      0,
      (sum, m) => sum + (m.unitPrice ?? 0) * m.quantityChange,
    );
    final todayItems = -_todaySales.fold<int>(
      0,
      (sum, m) => sum + m.quantityChange,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Log a Sale')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                _error!,
                style: const TextStyle(color: AppColors.danger),
              ),
            ),
          if (_selected == null) ...[
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
                  itemBuilder: (context, index) =>
                      _QuickPickCard(
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
            _SaleForm(
              product: _selected!,
              variant: _variant,
              quantity: _quantity,
              submitting: _submitting,
              onVariantChanged: (v) => setState(() {
                _variant = v;
                _quantity = 1;
              }),
              onQuantityChanged: (q) => setState(() => _quantity = q),
              onCancel: _reset,
              onSubmit: _recordSale,
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
                '$todayItems item(s) · ₵${todayTotal.toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_loadingSales)
            const Center(child: CircularProgressIndicator())
          else if (sold.isEmpty)
            const EmptyState(
              icon: Icons.point_of_sale_outlined,
              title: 'No sales logged today yet',
              message: 'Whatever you record above will show up here.',
            )
          else
            for (final sale in sold)
              _SaleRow(
                sale: sale,
                voided: voidedIds.contains(sale.id),
                onVoid: () => _voidSale(sale),
              ),
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

class _SaleRow extends StatelessWidget {
  final StockMovement sale;
  final bool voided;
  final VoidCallback onVoid;

  const _SaleRow({required this.sale, required this.voided, required this.onVoid});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: (voided ? AppColors.inkMuted : AppColors.success)
              .withValues(alpha: 0.12),
          child: Icon(
            voided ? Icons.undo : Icons.check,
            color: voided ? AppColors.inkMuted : AppColors.success,
          ),
        ),
        title: Text(
          '${sale.quantityChange.abs()} × ${sale.itemLabel}',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            decoration: voided ? TextDecoration.lineThrough : null,
            color: voided ? AppColors.inkMuted : null,
          ),
        ),
        subtitle: Text(
          [
            if (sale.performedByName != null) sale.performedByName!,
            '${sale.createdAt.toLocal().hour.toString().padLeft(2, '0')}:'
                '${sale.createdAt.toLocal().minute.toString().padLeft(2, '0')}',
          ].join(' · '),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '₵${sale.lineTotal.toStringAsFixed(2)}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            if (!voided)
              IconButton(
                icon: const Icon(Icons.undo, size: 18),
                tooltip: 'Void this sale',
                onPressed: onVoid,
              ),
          ],
        ),
      ),
    );
  }
}

class _SaleForm extends StatelessWidget {
  final Product product;
  final ProductVariant? variant;
  final int quantity;
  final bool submitting;
  final ValueChanged<ProductVariant> onVariantChanged;
  final ValueChanged<int> onQuantityChanged;
  final VoidCallback onCancel;
  final VoidCallback onSubmit;

  const _SaleForm({
    required this.product,
    required this.variant,
    required this.quantity,
    required this.submitting,
    required this.onVariantChanged,
    required this.onQuantityChanged,
    required this.onCancel,
    required this.onSubmit,
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
                onPressed: submitting ? null : onSubmit,
                icon: submitting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.check),
                label: const Text('Record Sale'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
