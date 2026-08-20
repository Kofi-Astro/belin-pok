/// Data models shared between apps/admin and apps/storefront -- these
/// mirror services/api/app/schemas.py response shapes 1:1 (Category,
/// Product, ProductVariant, ProductImage, Order, OrderItem, Address), so
/// both apps parse the same JSON the same way instead of drifting apart.
/// Models that differ meaningfully by app (StaffProfile, admin's
/// inventory-only Customer/StockMovement/LowStockVariant views) stay in
/// each app instead of being forced in here.
library;

class Category {
  final String id;
  final String name;
  final String slug;
  final String? description;
  final int displayOrder;

  Category({
    required this.id,
    required this.name,
    required this.slug,
    this.description,
    this.displayOrder = 0,
  });

  factory Category.fromJson(Map<String, dynamic> json) => Category(
    id: json['id'] as String,
    name: json['name'] as String,
    slug: json['slug'] as String,
    description: json['description'] as String?,
    displayOrder: json['display_order'] as int? ?? 0,
  );
}

class ProductVariant {
  final String id;
  final String productId;
  final String sku;
  final String size;
  final String? color;
  final String? colorHex;
  final double? priceOverride;
  final double? wholesalePrice;
  final double? packPrice;
  final int? packSize;
  final int stockQuantity;
  final int lowStockThreshold;
  final bool isActive;

  ProductVariant({
    required this.id,
    required this.productId,
    required this.sku,
    required this.size,
    required this.color,
    required this.colorHex,
    required this.priceOverride,
    required this.wholesalePrice,
    required this.packPrice,
    required this.packSize,
    required this.stockQuantity,
    required this.lowStockThreshold,
    required this.isActive,
  });

  bool get isLowStock => stockQuantity <= lowStockThreshold;
  bool get isInStock => stockQuantity > 0;
  bool get hasPackPricing => packPrice != null && packSize != null;

  factory ProductVariant.fromJson(Map<String, dynamic> json) => ProductVariant(
    id: json['id'] as String,
    productId: json['product_id'] as String,
    sku: json['sku'] as String,
    size: json['size'] as String,
    color: json['color'] as String?,
    colorHex: json['color_hex'] as String?,
    priceOverride: (json['price_override'] as num?)?.toDouble(),
    wholesalePrice: (json['wholesale_price'] as num?)?.toDouble(),
    packPrice: (json['pack_price'] as num?)?.toDouble(),
    packSize: json['pack_size'] as int?,
    stockQuantity: json['stock_quantity'] as int,
    lowStockThreshold: json['low_stock_threshold'] as int,
    isActive: json['is_active'] as bool,
  );
}

class ProductImage {
  final String id;
  final String productId;
  final String storagePath;
  final bool isPrimary;

  ProductImage({
    required this.id,
    required this.productId,
    required this.storagePath,
    required this.isPrimary,
  });

  factory ProductImage.fromJson(Map<String, dynamic> json) => ProductImage(
    id: json['id'] as String,
    productId: json['product_id'] as String,
    storagePath: json['storage_path'] as String,
    isPrimary: json['is_primary'] as bool,
  );

  /// The product-images bucket is public, so the URL is deterministic from
  /// the storage path -- no signed URL/extra round trip needed.
  String publicUrl(String supabaseUrl) =>
      '$supabaseUrl/storage/v1/object/public/product-images/$storagePath';
}

class Product {
  final String id;
  final String name;
  final String slug;
  final String categoryId;
  final String? description;
  final String? brand;
  final double basePrice;
  final String status;
  final List<ProductVariant> variants;
  final List<ProductImage> images;

  Product({
    required this.id,
    required this.name,
    required this.slug,
    required this.categoryId,
    required this.description,
    required this.brand,
    required this.basePrice,
    required this.status,
    this.variants = const [],
    this.images = const [],
  });

  ProductImage? get primaryImage {
    if (images.isEmpty) return null;
    return images.firstWhere((i) => i.isPrimary, orElse: () => images.first);
  }

  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: json['id'] as String,
    name: json['name'] as String,
    slug: json['slug'] as String,
    categoryId: json['category_id'] as String,
    description: json['description'] as String?,
    brand: json['brand'] as String?,
    basePrice: (json['base_price'] as num).toDouble(),
    status: json['status'] as String,
    variants:
        (json['variants'] as List<dynamic>?)
            ?.map((v) => ProductVariant.fromJson(v as Map<String, dynamic>))
            .toList() ??
        const [],
    images:
        (json['images'] as List<dynamic>?)
            ?.map((i) => ProductImage.fromJson(i as Map<String, dynamic>))
            .toList() ??
        const [],
  );
}

class Address {
  final String id;
  final String customerId;
  final String label;
  final String line1;
  final String? line2;
  final String city;
  final String? state;
  final String? postalCode;
  final String country;
  final bool isDefault;

  Address({
    required this.id,
    required this.customerId,
    required this.label,
    required this.line1,
    required this.line2,
    required this.city,
    required this.state,
    required this.postalCode,
    required this.country,
    required this.isDefault,
  });

  factory Address.fromJson(Map<String, dynamic> json) => Address(
    id: json['id'] as String,
    customerId: json['customer_id'] as String,
    label: json['label'] as String,
    line1: json['line1'] as String,
    line2: json['line2'] as String?,
    city: json['city'] as String,
    state: json['state'] as String?,
    postalCode: json['postal_code'] as String?,
    country: json['country'] as String,
    isDefault: json['is_default'] as bool,
  );

  String get oneLine => [
    line1,
    if (line2 != null && line2!.isNotEmpty) line2,
    city,
    if (state != null && state!.isNotEmpty) state,
    country,
  ].join(', ');
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
  final String fulfillmentMethod;
  final double total;
  final DateTime createdAt;
  final List<OrderItem> items;

  Order({
    required this.id,
    required this.orderNumber,
    required this.customerId,
    required this.orderType,
    required this.status,
    required this.fulfillmentMethod,
    required this.total,
    required this.createdAt,
    this.items = const [],
  });

  bool get isPickup => fulfillmentMethod == 'pickup';

  factory Order.fromJson(Map<String, dynamic> json) => Order(
    id: json['id'] as String,
    orderNumber: json['order_number'] as String,
    customerId: json['customer_id'] as String,
    orderType: json['order_type'] as String,
    status: json['status'] as String,
    // Defaults to 'delivery' for forward compatibility with any older
    // cached/served response that predates this field.
    fulfillmentMethod: json['fulfillment_method'] as String? ?? 'delivery',
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
