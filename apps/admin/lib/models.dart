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
  final DateTime createdAt;

  StockMovement({
    required this.id,
    required this.variantId,
    required this.movementType,
    required this.quantityChange,
    required this.reason,
    required this.createdAt,
  });

  factory StockMovement.fromJson(Map<String, dynamic> json) => StockMovement(
    id: json['id'] as String,
    variantId: json['variant_id'] as String,
    movementType: json['movement_type'] as String,
    quantityChange: json['quantity_change'] as int,
    reason: json['reason'] as String?,
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
