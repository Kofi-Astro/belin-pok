import 'package:flutter/material.dart';

import '../api_client.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

/// One-item-at-a-time entry for an in-person sale: find the product, pick
/// the size/color sold, say how many, record it. Deducts stock the moment
/// it's recorded (same stock-movements mechanism as everywhere else, just
/// with a workflow built around doing this repeatedly through the day)
/// and then resets straight back to search so the next item can be logged
/// without any extra navigation.
class LogSaleScreen extends StatefulWidget {
  const LogSaleScreen({super.key});

  @override
  State<LogSaleScreen> createState() => _LogSaleScreenState();
}

class _LoggedSale {
  final String label;
  final int quantity;
  final DateTime at;
  _LoggedSale({required this.label, required this.quantity, required this.at});
}

class _LogSaleScreenState extends State<LogSaleScreen> {
  final _api = ApiClient();
  final _searchController = TextEditingController();

  List<Product> _results = [];
  Product? _selected;
  ProductVariant? _variant;
  int _quantity = 1;
  bool _searching = false;
  bool _loadingProduct = false;
  bool _submitting = false;
  String? _error;
  final List<_LoggedSale> _loggedThisSession = [];

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
      final label =
          '${product.name} (${variant.size}'
          '${variant.color != null ? ' · ${variant.color}' : ''})';
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Recorded: $_quantity × $label')),
        );
        setState(() {
          _loggedThisSession.insert(
            0,
            _LoggedSale(
              label: label,
              quantity: _quantity,
              at: DateTime.now(),
            ),
          );
        });
        _reset();
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
            TextField(
              controller: _searchController,
              autofocus: true,
              decoration: InputDecoration(
                labelText: 'Find the item that was sold',
                hintText: 'Search by product name',
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
            const SizedBox(height: 16),
            if (_loadingProduct) const Center(child: CircularProgressIndicator()),
            for (final product in _results)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: ClipRRect(
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
                              product.primaryImage!.publicUrl(
                                AppConfig.supabaseUrl,
                              ),
                              fit: BoxFit.cover,
                              errorBuilder: (context, error, stack) =>
                                  const Icon(Icons.broken_image_outlined),
                            ),
                    ),
                  ),
                  title: Text(product.name),
                  subtitle: Text('₵${product.basePrice.toStringAsFixed(2)}'),
                  onTap: () => _selectProduct(product),
                ),
              ),
            if (_loggedThisSession.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                'Logged just now',
                style: Theme.of(
                  context,
                ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              for (final logged in _loggedThisSession)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.check_circle,
                        color: AppColors.success,
                        size: 18,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text('${logged.quantity} × ${logged.label}'),
                      ),
                    ],
                  ),
                ),
            ] else if (_results.isEmpty && _searchController.text.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: EmptyState(
                  icon: Icons.point_of_sale_outlined,
                  title: 'Search for what was sold',
                  message:
                      'Find the product above, pick the size/color, and '
                      "say how many -- it's deducted from stock right away.",
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
        ],
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
