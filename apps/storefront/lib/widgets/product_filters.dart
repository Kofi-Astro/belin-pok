import 'package:flutter/material.dart';

import '../theme.dart';

class ProductFilters {
  final double? minPrice;
  final double? maxPrice;
  final bool inStockOnly;
  final String sort;

  const ProductFilters({
    this.minPrice,
    this.maxPrice,
    this.inStockOnly = false,
    this.sort = 'name',
  });

  bool get isActive =>
      minPrice != null || maxPrice != null || inStockOnly || sort != 'name';

  int get activeCount =>
      (minPrice != null || maxPrice != null ? 1 : 0) +
      (inStockOnly ? 1 : 0) +
      (sort != 'name' ? 1 : 0);

  ProductFilters copyWith({
    double? minPrice,
    bool clearMinPrice = false,
    double? maxPrice,
    bool clearMaxPrice = false,
    bool? inStockOnly,
    String? sort,
  }) => ProductFilters(
    minPrice: clearMinPrice ? null : (minPrice ?? this.minPrice),
    maxPrice: clearMaxPrice ? null : (maxPrice ?? this.maxPrice),
    inStockOnly: inStockOnly ?? this.inStockOnly,
    sort: sort ?? this.sort,
  );
}

const kProductSortLabels = {
  'name': 'Name (A-Z)',
  'price_asc': 'Price: Low to high',
  'price_desc': 'Price: High to low',
  'newest': 'Newest',
};

/// Opens as a modal bottom sheet from the home screen's filter button.
/// Edits a local draft and only reports back to the caller (which
/// re-fetches the product list) when "Apply" is tapped, so adjusting a
/// price field doesn't trigger a network call per keystroke.
Future<ProductFilters?> showProductFiltersSheet(
  BuildContext context,
  ProductFilters current,
) {
  return showModalBottomSheet<ProductFilters>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (context) => _ProductFiltersSheet(initial: current),
  );
}

class _ProductFiltersSheet extends StatefulWidget {
  final ProductFilters initial;

  const _ProductFiltersSheet({required this.initial});

  @override
  State<_ProductFiltersSheet> createState() => _ProductFiltersSheetState();
}

class _ProductFiltersSheetState extends State<_ProductFiltersSheet> {
  late final _minController = TextEditingController(
    text: widget.initial.minPrice?.toStringAsFixed(0) ?? '',
  );
  late final _maxController = TextEditingController(
    text: widget.initial.maxPrice?.toStringAsFixed(0) ?? '',
  );
  late bool _inStockOnly = widget.initial.inStockOnly;
  late String _sort = widget.initial.sort;

  @override
  void dispose() {
    _minController.dispose();
    _maxController.dispose();
    super.dispose();
  }

  void _apply() {
    Navigator.of(context).pop(
      ProductFilters(
        minPrice: double.tryParse(_minController.text.trim()),
        maxPrice: double.tryParse(_maxController.text.trim()),
        inStockOnly: _inStockOnly,
        sort: _sort,
      ),
    );
  }

  void _clear() {
    Navigator.of(context).pop(const ProductFilters());
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Filters', style: Theme.of(context).textTheme.titleLarge),
              const Spacer(),
              TextButton(onPressed: _clear, child: const Text('Clear all')),
            ],
          ),
          const SizedBox(height: 16),
          Text('Sort by', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: kProductSortLabels.entries
                .map(
                  (entry) => ChoiceChip(
                    label: Text(entry.value),
                    selected: _sort == entry.key,
                    onSelected: (_) => setState(() => _sort = entry.key),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 20),
          Text(
            'Price range (₵)',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _minController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Min'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _maxController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Max'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('In stock only'),
            value: _inStockOnly,
            onChanged: (value) => setState(() => _inStockOnly = value),
            activeThumbColor: StorefrontColors.deepOrange,
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _apply,
              child: const Text('Apply filters'),
            ),
          ),
        ],
      ),
    );
  }
}
