import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api_client.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';
import 'image_upload_zone.dart';
import 'status_pill.dart';

/// Logging a delivery at the counter, one item after another without
/// leaving the dialog. "New item" needs only a photo, a name and a count --
/// category/price/size/color are tucked under "More details" and default
/// to placeholders server-side (see receive_stock in
/// services/api/app/routers/products.py), landing the item as a draft
/// that can't be sold until someone prices and publishes it from
/// Products. "Already in catalog" adds stock to an existing item,
/// including a size/color it didn't have before.
///
/// Pops true if anything was saved, so the screen behind can refresh.
class ReceiveStockDialog extends StatefulWidget {
  final ApiClient api;
  const ReceiveStockDialog({super.key, required this.api});

  @override
  State<ReceiveStockDialog> createState() => _ReceiveStockDialogState();
}

class _ReceiveStockDialogState extends State<ReceiveStockDialog> {
  bool _existing = false;

  final _nameController = TextEditingController();
  final _quantityController = TextEditingController();
  final _priceController = TextEditingController();
  final _sizeController = TextEditingController();
  final _colorController = TextEditingController();
  final _searchController = TextEditingController();
  final _nameFocus = FocusNode();
  final _searchFocus = FocusNode();

  List<Category> _categories = [];
  String? _categoryId;

  // Uploaded as soon as it's picked (see ApiClient.uploadIntakePhoto), so
  // by the time staff hit Save the photo is already in storage.
  Uint8List? _photoBytes;
  String? _photoPath;

  Timer? _searchDebounce;
  List<Product> _results = [];
  Product? _product;
  // null while _product is set means "a new size/color for this item".
  ProductVariant? _variant;

  bool _submitting = false;
  String? _error;
  String? _lastSaved;
  bool _savedAny = false;

  @override
  void initState() {
    super.initState();
    widget.api.listCategories().then((categories) {
      if (mounted) setState(() => _categories = categories);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    for (final c in [
      _nameController,
      _quantityController,
      _priceController,
      _sizeController,
      _colorController,
      _searchController,
    ]) {
      c.dispose();
    }
    _nameFocus.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  Future<void> _uploadPhoto(Uint8List bytes, String extension) async {
    final path = await widget.api.uploadIntakePhoto(
      bytes: bytes,
      fileExtension: extension,
    );
    if (mounted) {
      setState(() {
        _photoBytes = bytes;
        _photoPath = path;
      });
    }
  }

  void _onSearchChanged(String query) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () async {
      if (query.trim().isEmpty) {
        if (mounted) setState(() => _results = []);
        return;
      }
      try {
        final results = await widget.api.listProducts(search: query.trim());
        if (mounted) setState(() => _results = results.take(6).toList());
      } on ApiException {
        // Leave results as-is -- staff can keep typing to retry.
      }
    });
  }

  Future<void> _selectProduct(Product product) async {
    try {
      final full = await widget.api.getProduct(product.id);
      final variants = full.variants.where((v) => v.isActive).toList();
      setState(() {
        _product = full;
        _variant = variants.length == 1 ? variants.first : null;
        _results = [];
        _error = null;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<void> _submit() async {
    final quantity = int.tryParse(_quantityController.text.trim());
    final priceText = _priceController.text.trim();
    final price = priceText.isEmpty ? null : double.tryParse(priceText);
    String? problem;
    if (quantity == null || quantity <= 0) {
      problem = 'Enter how many came in';
    } else if (_existing && _product == null) {
      problem = 'Search for the item first';
    } else if (!_existing && _nameController.text.trim().isEmpty) {
      problem = "Enter the item's name";
    } else if (!_existing && _photoPath == null) {
      problem = 'Add a photo of the item';
    } else if (!_existing && priceText.isNotEmpty && price == null) {
      problem = 'Price must be a number';
    }
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final result = _existing
          ? await widget.api.receiveStock(
              productId: _product!.id,
              quantity: quantity!,
              size: _variant?.size ?? _sizeController.text.trim(),
              color: _variant != null
                  ? _variant!.color
                  : _colorController.text.trim(),
            )
          : await widget.api.receiveStock(
              name: _nameController.text.trim(),
              imageStoragePath: _photoPath,
              quantity: quantity!,
              categoryId: _categoryId,
              basePrice: price,
              size: _sizeController.text.trim(),
              color: _colorController.text.trim(),
            );
      final v = result.variant;
      setState(() {
        _savedAny = true;
        _lastSaved =
            '+$quantity ${result.product.name} '
            '(${v.size}${v.color != null ? ' · ${v.color}' : ''}) '
            '-- ${v.stockQuantity} in stock';
        _resetForNextItem();
      });
      (_existing ? _searchFocus : _nameFocus).requestFocus();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _resetForNextItem() {
    for (final c in [
      _nameController,
      _quantityController,
      _priceController,
      _sizeController,
      _colorController,
      _searchController,
    ]) {
      c.clear();
    }
    _categoryId = null;
    _photoBytes = null;
    _photoPath = null;
    _product = null;
    _variant = null;
    _results = [];
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Receive Stock'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(
                    value: false,
                    label: Text('New item'),
                    icon: Icon(Icons.add_box_outlined),
                  ),
                  ButtonSegment(
                    value: true,
                    label: Text('Already in catalog'),
                    icon: Icon(Icons.inventory_2_outlined),
                  ),
                ],
                selected: {_existing},
                onSelectionChanged: (s) => setState(() {
                  _existing = s.first;
                  _error = null;
                }),
              ),
              const SizedBox(height: 16),
              if (_lastSaved != null) _SavedBanner(text: _lastSaved!),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: AppColors.danger),
                  ),
                ),
              if (_existing) ..._buildExisting() else ..._buildNew(),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(_savedAny),
          child: const Text('Done'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Save & next'),
        ),
      ],
    );
  }

  Widget _quantityField() => TextField(
    controller: _quantityController,
    decoration: const InputDecoration(labelText: 'How many came in?'),
    keyboardType: TextInputType.number,
    onSubmitted: (_) => _submit(),
  );

  List<Widget> _buildNew() => [
    Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ImageUploadZone(
          upload: _uploadPhoto,
          previewBytes: _photoBytes,
          source: ImageSource.camera,
          label: 'Take Photo',
          width: 110,
          height: 110,
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            children: [
              TextField(
                controller: _nameController,
                focusNode: _nameFocus,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Item name',
                  hintText: 'e.g. Black Oversized Tee',
                ),
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 8),
              _quantityField(),
            ],
          ),
        ),
      ],
    ),
    const SizedBox(height: 8),
    Theme(
      // ExpansionTile draws top/bottom dividers by default, which look
      // out of place floating inside a dialog.
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 8),
        title: const Text(
          'More details (optional)',
          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
        subtitle: const Text(
          'Category, price, size, color -- or fill these in later',
          style: TextStyle(fontSize: 12, color: AppColors.inkMuted),
        ),
        children: [
          DropdownButtonFormField<String?>(
            initialValue: _categoryId,
            key: ValueKey(_categoryId),
            decoration: const InputDecoration(labelText: 'Category'),
            items: [
              const DropdownMenuItem(value: null, child: Text('Decide later')),
              for (final c in _categories.where(
                (c) => c.slug != 'uncategorized',
              ))
                DropdownMenuItem(value: c.id, child: Text(c.name)),
            ],
            onChanged: (v) => setState(() => _categoryId = v),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _priceController,
            decoration: const InputDecoration(
              labelText: 'Price',
              prefixText: '₵ ',
            ),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
          const SizedBox(height: 8),
          _sizeColorFields(),
        ],
      ),
    ),
    const Text(
      'Saved as a draft: it stays off the storefront and the till until '
      "it's priced and published from Products.",
      style: TextStyle(fontSize: 12, color: AppColors.inkMuted),
    ),
  ];

  Widget _sizeColorFields() => Row(
    children: [
      Expanded(
        child: TextField(
          controller: _sizeController,
          decoration: const InputDecoration(
            labelText: 'Size',
            hintText: 'One Size',
          ),
        ),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: TextField(
          controller: _colorController,
          decoration: const InputDecoration(labelText: 'Color'),
        ),
      ),
    ],
  );

  List<Widget> _buildExisting() {
    final product = _product;
    if (product == null) {
      return [
        TextField(
          controller: _searchController,
          focusNode: _searchFocus,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Search by name…',
            prefixIcon: Icon(Icons.search),
          ),
          onChanged: _onSearchChanged,
        ),
        for (final p in _results)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: _Thumb(product: p),
            title: Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: StatusPill(status: p.status),
            onTap: () => _selectProduct(p),
          ),
      ];
    }

    final variants = product.variants.where((v) => v.isActive).toList();
    return [
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: _Thumb(product: product),
        title: Text(
          product.name,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        trailing: TextButton(
          onPressed: () => setState(() {
            _product = null;
            _variant = null;
          }),
          child: const Text('Change'),
        ),
      ),
      const SizedBox(height: 4),
      const Text(
        'Which size/color?',
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 6),
      Wrap(
        spacing: 8,
        runSpacing: 6,
        children: [
          for (final v in variants)
            ChoiceChip(
              label: Text(
                '${v.size}${v.color != null ? ' · ${v.color}' : ''} '
                '(${v.stockQuantity})',
              ),
              selected: _variant?.id == v.id,
              onSelected: (_) => setState(() => _variant = v),
            ),
          ChoiceChip(
            avatar: const Icon(Icons.add, size: 16),
            label: const Text('New size/color'),
            selected: _variant == null,
            onSelected: (_) => setState(() => _variant = null),
          ),
        ],
      ),
      if (_variant == null) ...[
        const SizedBox(height: 8),
        _sizeColorFields(),
      ],
      const SizedBox(height: 8),
      _quantityField(),
    ];
  }
}

class _SavedBanner extends StatelessWidget {
  final String text;
  const _SavedBanner({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.success.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.check_circle, color: AppColors.success, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
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
    final image = product.primaryImage;
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Container(
        width: 40,
        height: 40,
        color: const Color(0xFFEFEBE3),
        child: image == null
            ? const Icon(Icons.checkroom_outlined, color: AppColors.inkMuted)
            : Image.network(
                image.publicUrl(AppConfig.supabaseUrl),
                fit: BoxFit.cover,
                errorBuilder: (context, error, stack) => const Icon(
                  Icons.broken_image_outlined,
                  color: AppColors.inkMuted,
                ),
              ),
      ),
    );
  }
}
