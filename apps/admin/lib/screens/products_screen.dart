import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';
import '../widgets/image_upload_zone.dart';
import '../widgets/product_image_thumb.dart';
import '../widgets/status_pill.dart';
import '../widgets/stock_movement_dialog.dart';

/// The product catalog: search/filter grid, and the entry point into
/// everything product-related -- creating a product (_ProductFormDialog),
/// its full detail view with photos/variants (_ProductDetailDialog), its
/// audit history (_ProductHistoryDialog), and per-variant size/color
/// creation and wholesale/pack pricing (_VariantFormDialog /
/// _VariantPricingDialog).
class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key});

  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  final _api = ApiClient();
  final _searchController = TextEditingController();
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
        _api.listProducts(
          status: _statusFilter,
          search: _searchController.text.trim(),
        ),
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
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
          const SizedBox(width: 8),
        ],
      ),
      floatingActionButton: canWrite
          ? FloatingActionButton.extended(
              onPressed: _openCreateDialog,
              icon: const Icon(Icons.add),
              label: const Text('Add Product'),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    decoration: const InputDecoration(
                      hintText: 'Search products by name…',
                      prefixIcon: Icon(Icons.search),
                      isDense: true,
                    ),
                    onSubmitted: (_) => _load(),
                  ),
                ),
                const SizedBox(width: 12),
                DropdownButton<String?>(
                  value: _statusFilter,
                  underline: const SizedBox(),
                  hint: const Text('All statuses'),
                  items: const [
                    DropdownMenuItem(value: null, child: Text('All statuses')),
                    DropdownMenuItem(value: 'draft', child: Text('Draft')),
                    DropdownMenuItem(value: 'active', child: Text('Active')),
                    DropdownMenuItem(
                      value: 'archived',
                      child: Text('Archived'),
                    ),
                  ],
                  onChanged: (v) {
                    setState(() => _statusFilter = v);
                    _load();
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                ? Center(child: Text('Something went wrong: $_error'))
                : _products.isEmpty
                ? const EmptyState(
                    icon: Icons.checkroom_outlined,
                    title: 'No products yet',
                    message:
                        'Tap "Add Product" below to add your first item, with photos.',
                  )
                : GridView.builder(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                    gridDelegate:
                        const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 240,
                          mainAxisSpacing: 16,
                          crossAxisSpacing: 16,
                          // A fixed pixel height (rather than childAspectRatio)
                          // keeps the card's text block from being squeezed
                          // into an overflow at narrower column widths -- with
                          // a ratio, shrinking the width also shrinks the
                          // height budget the text has to fit in.
                          mainAxisExtent: 268,
                        ),
                    itemCount: _products.length,
                    itemBuilder: (context, index) {
                      final product = _products[index];
                      return _ProductCard(
                        product: product,
                        categoryName: _categoryName(product.categoryId),
                        onTap: () => _openDetail(product),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

/// One tile in the catalog grid -- tapping it opens _ProductDetailDialog.
class _ProductCard extends StatelessWidget {
  final Product product;
  final String categoryName;
  final VoidCallback onTap;

  const _ProductCard({
    required this.product,
    required this.categoryName,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final image = product.primaryImage;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: 150,
              width: double.infinity,
              child: Container(
                color: const Color(0xFFEFEBE3),
                child: image == null
                    ? const Center(
                        child: Icon(
                          Icons.checkroom_outlined,
                          size: 40,
                          color: AppColors.inkMuted,
                        ),
                      )
                    : Image.network(
                        image.publicUrl(AppConfig.supabaseUrl),
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stack) => const Center(
                          child: Icon(
                            Icons.broken_image_outlined,
                            color: AppColors.inkMuted,
                          ),
                        ),
                      ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    categoryName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.inkMuted,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '₵${product.basePrice.toStringAsFixed(2)}',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      StatusPill(status: product.status),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// New-product creation: name/slug/category/brand/price -- photos and
/// variants are added afterward, from _ProductDetailDialog, once the
/// product itself exists.
class _ProductFormDialog extends StatefulWidget {
  final ApiClient api;
  final List<Category> categories;
  const _ProductFormDialog({required this.api, required this.categories});

  @override
  State<_ProductFormDialog> createState() => _ProductFormDialogState();
}

class _ProductFormDialogState extends State<_ProductFormDialog> {
  final _nameController = TextEditingController();
  final _brandController = TextEditingController();
  final _priceController = TextEditingController();
  String? _categoryId;
  bool _submitting = false;
  String? _error;

  Uint8List? _imageBytes;
  String? _imageExtension;

  String _slugify(String input) => input
      .toLowerCase()
      .trim()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');

  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 88,
    );
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    setState(() {
      _imageBytes = bytes;
      _imageExtension = picked.name.contains('.')
          ? picked.name.split('.').last.toLowerCase()
          : 'jpg';
    });
  }

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
      final product = await widget.api.createProduct(
        name: _nameController.text.trim(),
        slug: _slugify(_nameController.text),
        categoryId: _categoryId!,
        basePrice: price,
        brand: _brandController.text.trim(),
      );
      if (_imageBytes != null) {
        // The product photo is a nice-to-have on top of the product
        // itself -- if the upload alone fails (e.g. a network hiccup),
        // the product it belongs to was still created successfully, so
        // don't block on it. A photo can always be added afterward from
        // the product's detail view.
        try {
          await widget.api.uploadProductImage(
            productId: product.id,
            bytes: _imageBytes!,
            fileExtension: _imageExtension!,
            isPrimary: true,
          );
        } on ApiException {
          // Swallowed deliberately -- see comment above.
        }
      }
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
      title: const Text('Add Product'),
      content: SizedBox(
        width: 400,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: AppColors.danger),
                  ),
                ),
              const Text(
                'Photo',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.inkMuted,
                ),
              ),
              const SizedBox(height: 6),
              InkWell(
                onTap: _pickImage,
                borderRadius: BorderRadius.circular(14),
                child: DottedBorderBox(
                  child: SizedBox(
                    width: double.infinity,
                    height: 120,
                    child: _imageBytes == null
                        ? const Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.add_photo_alternate_outlined,
                                  color: AppColors.inkMuted,
                                  size: 28,
                                ),
                                SizedBox(height: 6),
                                Text(
                                  'Tap to add a photo',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: AppColors.inkMuted,
                                  ),
                                ),
                              ],
                            ),
                          )
                        : Stack(
                            fit: StackFit.expand,
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(13),
                                child: Image.memory(
                                  _imageBytes!,
                                  fit: BoxFit.cover,
                                ),
                              ),
                              Positioned(
                                top: 6,
                                right: 6,
                                child: InkWell(
                                  onTap: () => setState(() {
                                    _imageBytes = null;
                                    _imageExtension = null;
                                  }),
                                  customBorder: const CircleBorder(),
                                  child: Container(
                                    padding: const EdgeInsets.all(5),
                                    decoration: BoxDecoration(
                                      color: Colors.black.withValues(
                                        alpha: 0.55,
                                      ),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(
                                      Icons.close,
                                      size: 15,
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Product name',
                  hintText: 'e.g. Classic Snapback Cap',
                ),
                autofocus: true,
              ),
              const SizedBox(height: 12),
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
              const SizedBox(height: 12),
              TextField(
                controller: _brandController,
                decoration: const InputDecoration(
                  labelText: 'Brand (optional)',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _priceController,
                decoration: const InputDecoration(
                  labelText: 'Price',
                  prefixText: '₵ ',
                ),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'You can add more photos and sizes/colors after creating it.',
                style: TextStyle(fontSize: 12, color: AppColors.inkMuted),
              ),
            ],
          ),
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

/// A product's full working view: edit its fields, manage its photo
/// gallery (ImageUploadZone/ProductImageThumb), add/edit variants, and
/// publish/archive/delete it. Reloads itself from the API after any
/// change rather than mutating the passed-in Product in place, and
/// reports back via _changed whether the catalog list behind it needs
/// refreshing once closed.
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

  void _onGalleryChanged() {
    _changed = true;
    _reload();
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

  Future<void> _publish() async {
    await widget.api.activateProduct(widget.product.id);
    _changed = true;
    _reload();
  }

  Future<void> _confirmDelete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete this product?'),
        content: const Text(
          "This removes it for good -- there's no undoing it. If it's "
          'ever been ordered or had stock recorded, deleting is blocked '
          'automatically; archive it instead in that case.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.api.deleteProduct(widget.product.id);
      _changed = true;
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
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

  Future<void> _editPricing(ProductVariant variant) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _VariantPricingDialog(api: widget.api, variant: variant),
    );
    if (saved == true) {
      _changed = true;
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = context.watch<AuthController>().profile;
    final canWrite = profile?.canManageInventory ?? false;
    final canAdjustStock = profile?.canAdjustStock ?? false;
    final product = _full;

    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 640),
        child: product == null
            ? const SizedBox(
                height: 200,
                child: Center(child: CircularProgressIndicator()),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            product.name,
                            style: Theme.of(context).textTheme.titleLarge
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                        ),
                        if (profile?.isOwner ?? false)
                          IconButton(
                            icon: const Icon(Icons.history),
                            tooltip: 'Change history',
                            onPressed: () => showDialog(
                              context: context,
                              builder: (_) => _ProductHistoryDialog(
                                api: widget.api,
                                product: product,
                              ),
                            ),
                          ),
                        IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () => Navigator.of(context).pop(_changed),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(24, 4, 24, 0),
                    child: Row(
                      children: [
                        StatusPill(status: product.status),
                        const SizedBox(width: 10),
                        Text(
                          '₵${product.basePrice.toStringAsFixed(2)}',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Photos',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: [
                              for (final image in product.images)
                                ProductImageThumb(
                                  image: image,
                                  api: widget.api,
                                  onChanged: _onGalleryChanged,
                                ),
                              if (canWrite)
                                ImageUploadZone(
                                  productId: product.id,
                                  api: widget.api,
                                  isFirstImage: product.images.isEmpty,
                                  onUploaded: _onGalleryChanged,
                                ),
                            ],
                          ),
                          const SizedBox(height: 24),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Sizes & Colors',
                                style: Theme.of(context).textTheme.titleSmall,
                              ),
                              if (canWrite)
                                TextButton.icon(
                                  onPressed: _addVariant,
                                  icon: const Icon(Icons.add, size: 18),
                                  label: const Text('Add'),
                                ),
                            ],
                          ),
                          if (product.variants.isEmpty)
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                'No sizes/colors added yet.',
                                style: TextStyle(color: AppColors.inkMuted),
                              ),
                            ),
                          for (final v in product.variants)
                            Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: ListTile(
                                dense: true,
                                title: Text(
                                  '${v.size}${v.color != null ? ' · ${v.color}' : ''}  (${v.sku})',
                                ),
                                subtitle:
                                    (v.wholesalePrice != null ||
                                        v.hasPackPricing)
                                    ? Text(
                                        [
                                          if (v.wholesalePrice != null)
                                            'Wholesale ₵${v.wholesalePrice!.toStringAsFixed(2)}',
                                          if (v.hasPackPricing)
                                            'Pack of ${v.packSize} · ₵${v.packPrice!.toStringAsFixed(2)}',
                                        ].join(' · '),
                                        style: const TextStyle(
                                          fontSize: 11,
                                          color: AppColors.inkMuted,
                                        ),
                                      )
                                    : null,
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      'Stock: ${v.stockQuantity}',
                                      style: TextStyle(
                                        color: v.isLowStock
                                            ? AppColors.danger
                                            : null,
                                        fontWeight: v.isLowStock
                                            ? FontWeight.bold
                                            : null,
                                      ),
                                    ),
                                    if (canWrite)
                                      IconButton(
                                        icon: const Icon(
                                          Icons.sell_outlined,
                                          size: 18,
                                        ),
                                        tooltip: 'Edit pricing',
                                        onPressed: () => _editPricing(v),
                                      ),
                                    if (canAdjustStock)
                                      IconButton(
                                        icon: const Icon(Icons.tune, size: 18),
                                        tooltip: 'Adjust stock',
                                        onPressed: () => _adjustStock(v),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (canWrite)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          if (product.status != 'active')
                            TextButton.icon(
                              onPressed: _publish,
                              icon: const Icon(
                                Icons.storefront_outlined,
                                color: AppColors.success,
                              ),
                              label: const Text(
                                'Publish to Storefront',
                                style: TextStyle(color: AppColors.success),
                              ),
                            ),
                          if (product.status != 'archived')
                            TextButton.icon(
                              onPressed: _archive,
                              icon: const Icon(
                                Icons.archive_outlined,
                                color: AppColors.danger,
                              ),
                              label: const Text(
                                'Archive Product',
                                style: TextStyle(color: AppColors.danger),
                              ),
                            ),
                          TextButton.icon(
                            onPressed: _confirmDelete,
                            icon: const Icon(
                              Icons.delete_outline,
                              color: AppColors.danger,
                            ),
                            label: const Text(
                              'Delete Product',
                              style: TextStyle(color: AppColors.danger),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

/// This product's audit_log entries (create/update/delete) -- see
/// AuditLogEntry.changedFields in models.dart for how a before/after pair
/// gets narrowed to just what actually changed.
class _ProductHistoryDialog extends StatefulWidget {
  final ApiClient api;
  final Product product;
  const _ProductHistoryDialog({required this.api, required this.product});

  @override
  State<_ProductHistoryDialog> createState() => _ProductHistoryDialogState();
}

class _ProductHistoryDialogState extends State<_ProductHistoryDialog> {
  List<AuditLogEntry> _entries = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final entries = await widget.api.auditLog(
        tableName: 'products',
        recordId: widget.product.id,
      );
      if (mounted) setState(() => _entries = entries);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _actionLabel(String action) => switch (action) {
    'product.create' => 'Created',
    'product.update' => 'Edited',
    'product.delete' => 'Deleted',
    _ => action,
  };

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('History · ${widget.product.name}'),
      content: SizedBox(
        width: 420,
        height: 420,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
            ? Center(child: Text(_error!))
            : _entries.isEmpty
            ? const EmptyState(
                icon: Icons.history,
                title: 'No history yet',
                message: 'Edits to this product will show up here.',
              )
            : ListView.separated(
                itemCount: _entries.length,
                separatorBuilder: (_, _) => const Divider(),
                itemBuilder: (context, index) {
                  final entry = _entries[index];
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              _actionLabel(entry.action),
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            Text(
                              _formatDate(entry.createdAt.toLocal()),
                              style: const TextStyle(
                                color: AppColors.inkMuted,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                        Text(
                          entry.staffName ?? 'Unknown staff',
                          style: const TextStyle(
                            color: AppColors.inkMuted,
                            fontSize: 12,
                          ),
                        ),
                        for (final field in entry.changedFields)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              '$field: ${entry.oldValues?[field] ?? '—'} → '
                              '${entry.newValues?[field] ?? '—'}',
                              style: const TextStyle(fontSize: 13),
                            ),
                          ),
                      ],
                    ),
                  );
                },
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }

  String _formatDate(DateTime dt) =>
      '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} '
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}

/// Adds a new size/color variant to a product. SKU isn't a field here --
/// the backend generates one from the product + size + color (see
/// ApiClient.createVariant's comment).
class _VariantFormDialog extends StatefulWidget {
  final ApiClient api;
  final String productId;
  const _VariantFormDialog({required this.api, required this.productId});

  @override
  State<_VariantFormDialog> createState() => _VariantFormDialogState();
}

class _VariantFormDialogState extends State<_VariantFormDialog> {
  final _sizeController = TextEditingController();
  final _colorController = TextEditingController();
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (_sizeController.text.trim().isEmpty) {
      setState(() => _error = 'Size is required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.createVariant(
        widget.productId,
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
      title: const Text('Add size/color'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: AppColors.danger),
              ),
            ),
          TextField(
            controller: _sizeController,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Size',
              hintText: 'e.g. M, L, XL, One Size',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _colorController,
            decoration: const InputDecoration(labelText: 'Color (optional)'),
          ),
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              "The SKU is generated for you automatically.",
              style: TextStyle(fontSize: 12, color: AppColors.inkMuted),
            ),
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

/// Sets the three price points a variant can be sold at -- retail
/// (price_override, blank falls back to the product's base price),
/// wholesale (blank falls back to the retail price at checkout), and a
/// factory pack (price + how many units make up one pack; both or
/// neither, same rule the backend enforces).
/// Edits one variant's pricing: the retail override, wholesale unit
/// price, and factory-pack price/size -- everything except stock, which
/// only ever changes through a StockMovementDialog so it stays audited.
class _VariantPricingDialog extends StatefulWidget {
  final ApiClient api;
  final ProductVariant variant;
  const _VariantPricingDialog({required this.api, required this.variant});

  @override
  State<_VariantPricingDialog> createState() => _VariantPricingDialogState();
}

class _VariantPricingDialogState extends State<_VariantPricingDialog> {
  late final _retailController = TextEditingController(
    text: widget.variant.priceOverride?.toStringAsFixed(2) ?? '',
  );
  late final _wholesaleController = TextEditingController(
    text: widget.variant.wholesalePrice?.toStringAsFixed(2) ?? '',
  );
  late final _packPriceController = TextEditingController(
    text: widget.variant.packPrice?.toStringAsFixed(2) ?? '',
  );
  late final _packSizeController = TextEditingController(
    text: widget.variant.packSize?.toString() ?? '',
  );
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    final packPriceText = _packPriceController.text.trim();
    final packSizeText = _packSizeController.text.trim();
    if (packPriceText.isEmpty != packSizeText.isEmpty) {
      setState(
        () => _error =
            'Pack price and pack size must be set together, or both left blank',
      );
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.updateVariant(widget.variant.id, {
        'price_override': double.tryParse(_retailController.text.trim()),
        'wholesale_price': double.tryParse(_wholesaleController.text.trim()),
        'pack_price': double.tryParse(packPriceText),
        'pack_size': int.tryParse(packSizeText),
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _retailController.dispose();
    _wholesaleController.dispose();
    _packPriceController.dispose();
    _packSizeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Pricing · ${widget.variant.sku}'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger),
                ),
              ),
            TextField(
              controller: _retailController,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Retail price override (₵)',
                helperText: 'Leave blank to use the product\'s base price.',
              ),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _wholesaleController,
              decoration: const InputDecoration(
                labelText: 'Wholesale price (₵)',
                helperText: 'Leave blank to fall back to the retail price.',
              ),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _packPriceController,
                    decoration: const InputDecoration(
                      labelText: 'Pack price (₵)',
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _packSizeController,
                    decoration: const InputDecoration(
                      labelText: 'Units per pack',
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'e.g. a factory-sealed box of 6 -- both fields together, or leave both blank.',
                style: TextStyle(fontSize: 12, color: AppColors.inkMuted),
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
              : const Text('Save'),
        ),
      ],
    );
  }
}
