import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../models.dart';
import '../widgets/stock_movement_dialog.dart';

class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key});

  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  final _api = ApiClient();
  List<Product> _products = [];
  List<Category> _categories = [];
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
        _api.listProducts(status: _statusFilter),
        _api.listCategories(),
      ]);
      setState(() {
        _products = results[0] as List<Product>;
        _categories = results[1] as List<Category>;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      setState(() => _loading = false);
    }
  }

  String _categoryName(String id) => _categories
      .firstWhere(
        (c) => c.id == id,
        orElse: () => Category(id: id, name: '—', slug: ''),
      )
      .name;

  Future<void> _openCreateDialog() async {
    final created = await showDialog<bool>(
      context: context,
      builder: (_) => _ProductFormDialog(api: _api, categories: _categories),
    );
    if (created == true) _load();
  }

  Future<void> _openDetail(Product product) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => _ProductDetailDialog(api: _api, product: product),
    );
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final canWrite =
        context.watch<AuthController>().profile?.canManageInventory ?? false;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Products'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: DropdownButton<String?>(
              value: _statusFilter,
              hint: const Text('All statuses'),
              items: const [
                DropdownMenuItem(value: null, child: Text('All statuses')),
                DropdownMenuItem(value: 'draft', child: Text('Draft')),
                DropdownMenuItem(value: 'active', child: Text('Active')),
                DropdownMenuItem(value: 'archived', child: Text('Archived')),
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
      floatingActionButton: canWrite
          ? FloatingActionButton.extended(
              onPressed: _openCreateDialog,
              icon: const Icon(Icons.add),
              label: const Text('Add product'),
            )
          : null,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text('Error: $_error'))
          : _products.isEmpty
          ? const Center(child: Text('No products yet.'))
          : ListView.separated(
              itemCount: _products.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final product = _products[index];
                return ListTile(
                  title: Text(product.name),
                  subtitle: Text(
                    '${_categoryName(product.categoryId)} · \$${product.basePrice.toStringAsFixed(2)}',
                  ),
                  trailing: Chip(label: Text(product.status)),
                  onTap: () => _openDetail(product),
                );
              },
            ),
    );
  }
}

class _ProductFormDialog extends StatefulWidget {
  final ApiClient api;
  final List<Category> categories;
  const _ProductFormDialog({required this.api, required this.categories});

  @override
  State<_ProductFormDialog> createState() => _ProductFormDialogState();
}

class _ProductFormDialogState extends State<_ProductFormDialog> {
  final _nameController = TextEditingController();
  final _slugController = TextEditingController();
  final _brandController = TextEditingController();
  final _priceController = TextEditingController();
  String? _categoryId;
  bool _submitting = false;
  String? _error;

  String _slugify(String input) => input
      .toLowerCase()
      .trim()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');

  Future<void> _submit() async {
    if (_categoryId == null ||
        _nameController.text.trim().isEmpty ||
        _priceController.text.trim().isEmpty) {
      setState(() => _error = 'Name, category, and price are required');
      return;
    }
    final price = double.tryParse(_priceController.text.trim());
    if (price == null) {
      setState(() => _error = 'Price must be a number');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.createProduct(
        name: _nameController.text.trim(),
        slug: _slugController.text.trim().isEmpty
            ? _slugify(_nameController.text)
            : _slugController.text.trim(),
        categoryId: _categoryId!,
        basePrice: price,
        brand: _brandController.text.trim(),
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
    return AlertDialog(
      title: const Text('Add product'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _slugController,
              decoration: const InputDecoration(
                labelText: 'Slug (optional, auto-generated)',
              ),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _categoryId,
              decoration: const InputDecoration(labelText: 'Category'),
              items: widget.categories
                  .map(
                    (c) => DropdownMenuItem(value: c.id, child: Text(c.name)),
                  )
                  .toList(),
              onChanged: (v) => setState(() => _categoryId = v),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _brandController,
              decoration: const InputDecoration(labelText: 'Brand (optional)'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _priceController,
              decoration: const InputDecoration(
                labelText: 'Base price',
                prefixText: '\$',
              ),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
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
          child: const Text('Create'),
        ),
      ],
    );
  }
}

class _ProductDetailDialog extends StatefulWidget {
  final ApiClient api;
  final Product product;
  const _ProductDetailDialog({required this.api, required this.product});

  @override
  State<_ProductDetailDialog> createState() => _ProductDetailDialogState();
}

class _ProductDetailDialogState extends State<_ProductDetailDialog> {
  Product? _full;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final full = await widget.api.getProduct(widget.product.id);
    if (mounted) setState(() => _full = full);
  }

  Future<void> _addVariant() async {
    final added = await showDialog<bool>(
      context: context,
      builder: (_) =>
          _VariantFormDialog(api: widget.api, productId: widget.product.id),
    );
    if (added == true) {
      _changed = true;
      _reload();
    }
  }

  Future<void> _archive() async {
    await widget.api.archiveProduct(widget.product.id);
    _changed = true;
    if (mounted) Navigator.of(context).pop(true);
  }

  Future<void> _adjustStock(ProductVariant variant) async {
    final adjusted = await showDialog<bool>(
      context: context,
      builder: (_) => StockMovementDialog(api: widget.api, variant: variant),
    );
    if (adjusted == true) {
      _changed = true;
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final canWrite =
        context.watch<AuthController>().profile?.canManageInventory ?? false;
    final product = _full;

    return AlertDialog(
      title: Text(widget.product.name),
      content: SizedBox(
        width: 480,
        child: product == null
            ? const SizedBox(
                height: 100,
                child: Center(child: CircularProgressIndicator()),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Status: ${product.status}'),
                  Text('Base price: \$${product.basePrice.toStringAsFixed(2)}'),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Variants',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      if (canWrite)
                        TextButton.icon(
                          onPressed: _addVariant,
                          icon: const Icon(Icons.add),
                          label: const Text('Add'),
                        ),
                    ],
                  ),
                  if (product.variants.isEmpty) const Text('No variants yet.'),
                  for (final v in product.variants)
                    ListTile(
                      dense: true,
                      title: Text(
                        '${v.size}${v.color != null ? ' · ${v.color}' : ''}  (${v.sku})',
                      ),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Stock: ${v.stockQuantity}',
                            style: TextStyle(
                              color: v.isLowStock ? Colors.red : null,
                              fontWeight: v.isLowStock ? FontWeight.bold : null,
                            ),
                          ),
                          if (canWrite)
                            IconButton(
                              icon: const Icon(Icons.tune, size: 18),
                              tooltip: 'Adjust stock',
                              onPressed: () => _adjustStock(v),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
      ),
      actions: [
        if (canWrite && product?.status != 'archived')
          TextButton(
            onPressed: _archive,
            child: const Text('Archive', style: TextStyle(color: Colors.red)),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(_changed),
          child: const Text('Close'),
        ),
      ],
    );
  }
}

class _VariantFormDialog extends StatefulWidget {
  final ApiClient api;
  final String productId;
  const _VariantFormDialog({required this.api, required this.productId});

  @override
  State<_VariantFormDialog> createState() => _VariantFormDialogState();
}

class _VariantFormDialogState extends State<_VariantFormDialog> {
  final _skuController = TextEditingController();
  final _sizeController = TextEditingController();
  final _colorController = TextEditingController();
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (_skuController.text.trim().isEmpty ||
        _sizeController.text.trim().isEmpty) {
      setState(() => _error = 'SKU and size are required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.createVariant(
        widget.productId,
        sku: _skuController.text.trim(),
        size: _sizeController.text.trim(),
        color: _colorController.text.trim(),
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
    return AlertDialog(
      title: const Text('Add variant'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          TextField(
            controller: _skuController,
            decoration: const InputDecoration(labelText: 'SKU'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _sizeController,
            decoration: const InputDecoration(labelText: 'Size'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _colorController,
            decoration: const InputDecoration(labelText: 'Color (optional)'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: const Text('Add'),
        ),
      ],
    );
  }
}
