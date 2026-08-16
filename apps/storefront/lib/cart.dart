import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/foundation.dart';

/// One line in the cart: a variant plus how many, with the product/variant
/// kept alongside so the cart/checkout screens can render names, images,
/// and prices without a re-fetch.
class CartLine {
  final Product product;
  final ProductVariant variant;
  int quantity;

  CartLine({
    required this.product,
    required this.variant,
    required this.quantity,
  });

  double get unitPrice => variant.priceOverride ?? product.basePrice;
  double get lineTotal => unitPrice * quantity;
}

/// In-memory cart for the current browser session -- deliberately not
/// persisted to browser storage (Phase 2 scope keeps this simple; a
/// refresh clears the cart, same as walking away from a physical basket).
class CartController extends ChangeNotifier {
  final Map<String, CartLine> _lines = {};

  List<CartLine> get lines => List.unmodifiable(_lines.values);
  bool get isEmpty => _lines.isEmpty;
  int get itemCount => _lines.values.fold(0, (sum, l) => sum + l.quantity);
  double get total => _lines.values.fold(0.0, (sum, l) => sum + l.lineTotal);

  /// variant_id -> quantity, the shape POST /orders/checkout expects.
  Map<String, int> get quantitiesByVariantId => {
    for (final line in _lines.values) line.variant.id: line.quantity,
  };

  void add(Product product, ProductVariant variant, {int quantity = 1}) {
    final existing = _lines[variant.id];
    if (existing != null) {
      existing.quantity += quantity;
    } else {
      _lines[variant.id] = CartLine(
        product: product,
        variant: variant,
        quantity: quantity,
      );
    }
    notifyListeners();
  }

  void updateQuantity(String variantId, int quantity) {
    if (quantity <= 0) {
      _lines.remove(variantId);
    } else {
      final line = _lines[variantId];
      if (line != null) line.quantity = quantity;
    }
    notifyListeners();
  }

  void remove(String variantId) {
    _lines.remove(variantId);
    notifyListeners();
  }

  void clear() {
    _lines.clear();
    notifyListeners();
  }
}
