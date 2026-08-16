import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../cart.dart';
import '../config.dart';
import '../widgets/storefront_scaffold.dart';

class ProductDetailScreen extends StatefulWidget {
  final String productId;

  const ProductDetailScreen({super.key, required this.productId});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  final _api = StorefrontApiClient();

  Product? _product;
  ProductVariant? _selectedVariant;
  int _quantity = 1;
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
      final product = await _api.getProduct(widget.productId);
      setState(() {
        _product = product;
        _selectedVariant =
            product.variants.where((v) => v.isInStock).firstOrNull ??
            product.variants.firstOrNull;
        _loading = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _error = e.statusCode == 404
            ? 'This product is no longer available.'
            : e.message;
        _loading = false;
      });
    }
  }

  void _addToCart() {
    final product = _product;
    final variant = _selectedVariant;
    if (product == null || variant == null || !variant.isInStock) return;
    context.read<CartController>().add(product, variant, quantity: _quantity);
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Added ${product.name} to cart')));
  }

  @override
  Widget build(BuildContext context) {
    return StorefrontScaffold(
      showBackButton: true,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text(_error!))
          : _buildContent(_product!),
    );
  }

  Widget _buildContent(Product product) {
    final variant = _selectedVariant;
    final unitPrice = variant?.priceOverride ?? product.basePrice;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 1.1,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: product.primaryImage != null
                    ? Image.network(
                        product.primaryImage!.publicUrl(AppConfig.supabaseUrl),
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) => Container(
                          color: AppColors.canvas,
                          child: const Icon(
                            Icons.checkroom,
                            size: 64,
                            color: AppColors.inkMuted,
                          ),
                        ),
                      )
                    : Container(
                        color: AppColors.canvas,
                        child: const Icon(
                          Icons.checkroom,
                          size: 64,
                          color: AppColors.inkMuted,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              product.name,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            if (product.brand != null) ...[
              const SizedBox(height: 4),
              Text(
                product.brand!,
                style: const TextStyle(color: AppColors.inkMuted),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              '₵${unitPrice.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            if (product.description != null) ...[
              const SizedBox(height: 16),
              Text(product.description!),
            ],
            const SizedBox(height: 24),
            Text('Options', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (product.variants.isEmpty)
              const Text(
                'Currently unavailable.',
                style: TextStyle(color: AppColors.inkMuted),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: product.variants.map((v) {
                  final label = v.color != null && v.color!.isNotEmpty
                      ? '${v.size} · ${v.color}'
                      : v.size;
                  final selected = v.id == variant?.id;
                  return ChoiceChip(
                    label: Text(v.isInStock ? label : '$label (out of stock)'),
                    selected: selected,
                    // Out-of-stock variants stay visible but disabled --
                    // a shopper should see a color/size exists, just not
                    // pick it, rather than it silently vanishing.
                    onSelected: v.isInStock
                        ? (_) => setState(() => _selectedVariant = v)
                        : null,
                  );
                }).toList(),
              ),
            const SizedBox(height: 24),
            Row(
              children: [
                _QuantityStepper(
                  quantity: _quantity,
                  max: variant?.stockQuantity ?? 1,
                  onChanged: (q) => setState(() => _quantity = q),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: FilledButton(
                    onPressed: variant != null && variant.isInStock
                        ? _addToCart
                        : null,
                    child: Text(
                      variant == null || !variant.isInStock
                          ? 'Out of stock'
                          : 'Add to cart',
                    ),
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

class _QuantityStepper extends StatelessWidget {
  final int quantity;
  final int max;
  final ValueChanged<int> onChanged;

  const _QuantityStepper({
    required this.quantity,
    required this.max,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFCBC6BB)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.remove),
            onPressed: quantity > 1 ? () => onChanged(quantity - 1) : null,
          ),
          Text(
            '$quantity',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: quantity < max ? () => onChanged(quantity + 1) : null,
          ),
        ],
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
