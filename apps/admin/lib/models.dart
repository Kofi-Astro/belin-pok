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

class Category {
  final String id;
  final String name;
  final String slug;

  Category({required this.id, required this.name, required this.slug});

  factory Category.fromJson(Map<String, dynamic> json) => Category(
    id: json['id'] as String,
    name: json['name'] as String,
    slug: json['slug'] as String,
  );
}

class ProductVariant {
  final String id;
  final String productId;
  final String sku;
  final String size;
  final String? color;
  final double? priceOverride;
  final int stockQuantity;
  final int lowStockThreshold;
  final bool isActive;

  ProductVariant({
    required this.id,
    required this.productId,
    required this.sku,
    required this.size,
    required this.color,
    required this.priceOverride,
    required this.stockQuantity,
    required this.lowStockThreshold,
    required this.isActive,
  });

  bool get isLowStock => stockQuantity <= lowStockThreshold;

  factory ProductVariant.fromJson(Map<String, dynamic> json) => ProductVariant(
    id: json['id'] as String,
    productId: json['product_id'] as String,
    sku: json['sku'] as String,
    size: json['size'] as String,
    color: json['color'] as String?,
    priceOverride: (json['price_override'] as num?)?.toDouble(),
    stockQuantity: json['stock_quantity'] as int,
    lowStockThreshold: json['low_stock_threshold'] as int,
    isActive: json['is_active'] as bool,
  );
}

class Product {
  final String id;
  final String name;
  final String slug;
  final String categoryId;
  final String? brand;
  final double basePrice;
  final String status;
  final List<ProductVariant> variants;

  Product({
    required this.id,
    required this.name,
    required this.slug,
    required this.categoryId,
    required this.brand,
    required this.basePrice,
    required this.status,
    this.variants = const [],
  });

  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: json['id'] as String,
    name: json['name'] as String,
    slug: json['slug'] as String,
    categoryId: json['category_id'] as String,
    brand: json['brand'] as String?,
    basePrice: (json['base_price'] as num).toDouble(),
    status: json['status'] as String,
    variants:
        (json['variants'] as List<dynamic>?)
            ?.map((v) => ProductVariant.fromJson(v as Map<String, dynamic>))
            .toList() ??
        const [],
  );
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

class OrderItem {
  final String id;
  final String variantId;
  final int quantity;
  final double unitPrice;
  final double lineTotal;

  OrderItem({
    required this.id,
    required this.variantId,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) => OrderItem(
    id: json['id'] as String,
    variantId: json['variant_id'] as String,
    quantity: json['quantity'] as int,
    unitPrice: (json['unit_price'] as num).toDouble(),
    lineTotal: (json['line_total'] as num).toDouble(),
  );
}

class Order {
  final String id;
  final String orderNumber;
  final String customerId;
  final String orderType;
  final String status;
  final double total;
  final DateTime createdAt;
  final List<OrderItem> items;

  Order({
    required this.id,
    required this.orderNumber,
    required this.customerId,
    required this.orderType,
    required this.status,
    required this.total,
    required this.createdAt,
    this.items = const [],
  });

  factory Order.fromJson(Map<String, dynamic> json) => Order(
    id: json['id'] as String,
    orderNumber: json['order_number'] as String,
    customerId: json['customer_id'] as String,
    orderType: json['order_type'] as String,
    status: json['status'] as String,
    total: (json['total'] as num).toDouble(),
    createdAt: DateTime.parse(json['created_at'] as String),
    items:
        (json['items'] as List<dynamic>?)
            ?.map((i) => OrderItem.fromJson(i as Map<String, dynamic>))
            .toList() ??
        const [],
  );
}

const kOrderStatuses = [
  'pending',
  'paid',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
];
const kStaffRoles = [
  'owner',
  'inventory_manager',
  'order_fulfillment',
  'viewer',
];
