// Category/ProductVariant/ProductImage/Product/OrderItem/Order/
// kOrderStatuses now live in belpok_core (shared with apps/storefront --
// both apps parse the same API response shapes). Re-exported here so this
// app's existing `import 'models.dart'` / relative imports keep resolving
// them; imported (not just exported) below because LowStockVariant, an
// admin-only model, is itself built out of ProductVariant.
import 'package:belpok_core/belpok_core.dart';

export 'package:belpok_core/belpok_core.dart'
    show
        Category,
        Order,
        OrderItem,
        Product,
        ProductImage,
        ProductVariant,
        kOrderStatuses;

class StaffProfile {
  final String id;
  final String email;
  final String fullName;
  final String role;
  final bool isActive;

  StaffProfile({
    required this.id,
    required this.email,
    required this.fullName,
    required this.role,
    required this.isActive,
  });

  factory StaffProfile.fromJson(Map<String, dynamic> json) => StaffProfile(
    id: json['id'] as String,
    email: json['email'] as String,
    fullName: json['full_name'] as String,
    role: json['role'] as String,
    isActive: json['is_active'] as bool,
  );

  bool get isOwner => role == 'owner';
  bool get canManageInventory => role == 'owner' || role == 'inventory_manager';

  /// Narrower than [canManageInventory]: lets front-of-shop staff log a
  /// stock movement (e.g. a walk-in sale) without granting product
  /// management (creating, editing, publishing, archiving).
  bool get canAdjustStock =>
      canManageInventory || role == 'order_fulfillment';
  bool get canManageOrders => role == 'owner' || role == 'order_fulfillment';
}

/// GET /variants/low-stock joins back to the product -- non-technical
/// staff recognize items by name/photo, not a SKU code.
class LowStockVariant {
  final ProductVariant variant;
  final String productName;
  final String? imageStoragePath;

  LowStockVariant({
    required this.variant,
    required this.productName,
    required this.imageStoragePath,
  });

  factory LowStockVariant.fromJson(Map<String, dynamic> json) =>
      LowStockVariant(
        variant: ProductVariant.fromJson(json),
        productName: json['product_name'] as String,
        imageStoragePath: json['image_storage_path'] as String?,
      );

  String? publicImageUrl(String supabaseUrl) => imageStoragePath == null
      ? null
      : '$supabaseUrl/storage/v1/object/public/product-images/$imageStoragePath';
}

class StockMovement {
  final String id;
  final String variantId;
  final String movementType;
  final int quantityChange;
  final String? reason;
  final String? referenceType;
  final String? referenceId;
  final DateTime createdAt;
  final String? productName;
  final String? variantSku;
  final String? variantSize;
  final String? variantColor;
  final String? performedByName;
  final String? performedByRole;
  final double? unitPrice;

  StockMovement({
    required this.id,
    required this.variantId,
    required this.movementType,
    required this.quantityChange,
    required this.reason,
    required this.createdAt,
    this.referenceType,
    this.referenceId,
    this.productName,
    this.variantSku,
    this.variantSize,
    this.variantColor,
    this.performedByName,
    this.performedByRole,
    this.unitPrice,
  });

  /// A walk-in sale logged by front-of-shop staff, rather than by a
  /// manager or the storefront checkout -- the case owners/inventory
  /// managers most want called out in the activity feed.
  bool get isFloorSale =>
      performedByRole == 'order_fulfillment' && movementType == 'sale';

  String get itemLabel =>
      '${productName ?? 'Item'}'
      '${variantSize != null ? ' ($variantSize${variantColor != null ? ' · $variantColor' : ''})' : ''}';

  double get lineTotal => (unitPrice ?? 0) * quantityChange.abs();

  factory StockMovement.fromJson(Map<String, dynamic> json) => StockMovement(
    id: json['id'] as String,
    variantId: json['variant_id'] as String,
    movementType: json['movement_type'] as String,
    quantityChange: json['quantity_change'] as int,
    reason: json['reason'] as String?,
    referenceType: json['reference_type'] as String?,
    referenceId: json['reference_id'] as String?,
    createdAt: DateTime.parse(json['created_at'] as String),
    productName: json['product_name'] as String?,
    variantSku: json['variant_sku'] as String?,
    variantSize: json['variant_size'] as String?,
    variantColor: json['variant_color'] as String?,
    performedByName: json['performed_by_name'] as String?,
    performedByRole: json['performed_by_role'] as String?,
    unitPrice: (json['unit_price'] as num?)?.toDouble(),
  );
}

class DailySales {
  final DateTime day;
  final int itemsSold;
  final double totalAmount;

  DailySales({
    required this.day,
    required this.itemsSold,
    required this.totalAmount,
  });

  factory DailySales.fromJson(Map<String, dynamic> json) => DailySales(
    day: DateTime.parse(json['day'] as String),
    itemsSold: json['items_sold'] as int,
    totalAmount: (json['total_amount'] as num).toDouble(),
  );
}

class PosSaleItem {
  final String variantId;
  final String productName;
  final String variantSize;
  final String? variantColor;
  final int quantity;
  final double unitPrice;
  final double lineTotal;

  PosSaleItem({
    required this.variantId,
    required this.productName,
    required this.variantSize,
    required this.variantColor,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
  });

  String get label =>
      '$productName ($variantSize${variantColor != null ? ' · $variantColor' : ''})';

  factory PosSaleItem.fromJson(Map<String, dynamic> json) => PosSaleItem(
    variantId: json['variant_id'] as String,
    productName: json['product_name'] as String,
    variantSize: json['variant_size'] as String,
    variantColor: json['variant_color'] as String?,
    quantity: json['quantity'] as int,
    unitPrice: (json['unit_price'] as num).toDouble(),
    lineTotal: (json['line_total'] as num).toDouble(),
  );
}

class PosSalePayment {
  final String method;
  final double amount;

  PosSalePayment({required this.method, required this.amount});

  factory PosSalePayment.fromJson(Map<String, dynamic> json) =>
      PosSalePayment(
        method: json['method'] as String,
        amount: (json['amount'] as num).toDouble(),
      );
}

class PosSale {
  final String id;
  final String? customerId;
  final String status;
  final DateTime createdAt;
  final String? staffName;
  final String? customerName;
  final List<PosSaleItem> items;
  final List<PosSalePayment> payments;
  final double total;

  PosSale({
    required this.id,
    required this.customerId,
    required this.status,
    required this.createdAt,
    required this.staffName,
    required this.customerName,
    required this.items,
    required this.payments,
    required this.total,
  });

  bool get isVoided => status == 'voided';

  factory PosSale.fromJson(Map<String, dynamic> json) => PosSale(
    id: json['id'] as String,
    customerId: json['customer_id'] as String?,
    status: json['status'] as String,
    createdAt: DateTime.parse(json['created_at'] as String),
    staffName: json['staff_name'] as String?,
    customerName: json['customer_name'] as String?,
    items: (json['items'] as List)
        .map((e) => PosSaleItem.fromJson(e as Map<String, dynamic>))
        .toList(),
    payments: (json['payments'] as List)
        .map((e) => PosSalePayment.fromJson(e as Map<String, dynamic>))
        .toList(),
    total: (json['total'] as num).toDouble(),
  );
}

class AuditLogEntry {
  final String id;
  final String action;
  final String? staffName;
  final Map<String, dynamic>? oldValues;
  final Map<String, dynamic>? newValues;
  final DateTime createdAt;

  AuditLogEntry({
    required this.id,
    required this.action,
    required this.staffName,
    required this.oldValues,
    required this.newValues,
    required this.createdAt,
  });

  /// Field names whose old/new value actually differ -- what's worth
  /// showing, rather than every field the update touched (exclude_unset on
  /// the API side already narrows this some, but a field can be "set" to
  /// the value it already had).
  List<String> get changedFields {
    final old = oldValues ?? const {};
    final fresh = newValues ?? const {};
    return {...old.keys, ...fresh.keys}
        .where((k) => old[k] != fresh[k])
        .toList();
  }

  factory AuditLogEntry.fromJson(Map<String, dynamic> json) => AuditLogEntry(
    id: json['id'] as String,
    action: json['action'] as String,
    staffName: json['staff_name'] as String?,
    oldValues: json['old_values'] as Map<String, dynamic>?,
    newValues: json['new_values'] as Map<String, dynamic>?,
    createdAt: DateTime.parse(json['created_at'] as String),
  );
}

class Customer {
  final String id;
  final String fullName;
  final String email;
  final String customerType;
  final String status;

  Customer({
    required this.id,
    required this.fullName,
    required this.email,
    required this.customerType,
    required this.status,
  });

  factory Customer.fromJson(Map<String, dynamic> json) => Customer(
    id: json['id'] as String,
    fullName: json['full_name'] as String,
    email: json['email'] as String,
    customerType: json['customer_type'] as String,
    status: json['status'] as String,
  );
}

const kStaffRoles = [
  'owner',
  'inventory_manager',
  'order_fulfillment',
  'viewer',
];
