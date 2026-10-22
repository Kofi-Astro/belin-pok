import 'dart:typed_data';

import 'package:belpok_core/belpok_core.dart';

import 'config.dart';
import 'models.dart';
import 'session.dart';

export 'package:belpok_core/belpok_core.dart' show ApiException;

/// Thin wrapper around the FastAPI backend. Every call attaches the shared
/// session's access token (see session.dart) as a Bearer token, refreshing
/// it when needed -- the backend verifies it and resolves it to a `staff`
/// row (see services/api/app/deps.py).
class ApiClient {
  final ApiHttp _http = ApiHttp(
    baseUrl: AppConfig.apiBaseUrl,
    session: authSession,
  );

  Future<dynamic> _get(String path, [Map<String, String>? query]) =>
      _http.get(path, query);
  Future<dynamic> _post(String path, Map<String, dynamic> body) =>
      _http.post(path, body);
  Future<dynamic> _patch(String path, Map<String, dynamic> body) =>
      _http.patch(path, body);
  Future<dynamic> _delete(String path) => _http.delete(path);

  // ---------- staff ----------

  Future<StaffProfile> getMyProfile() async =>
      StaffProfile.fromJson(await _get('/staff/me') as Map<String, dynamic>);

  Future<List<StaffProfile>> listStaff() async => (await _get('/staff') as List)
      .map((e) => StaffProfile.fromJson(e as Map<String, dynamic>))
      .toList();

  /// Creates the staff member and returns their set-password link. It's
  /// emailed to them too when the API has email set up, but the owner can
  /// always copy it from here and send it directly (e.g. on WhatsApp).
  Future<String> inviteStaff({
    required String email,
    required String fullName,
    required String role,
  }) async {
    final json =
        await _post('/staff/invite', {
              'email': email,
              'full_name': fullName,
              'role': role,
            })
            as Map<String, dynamic>;
    return json['invite_link'] as String;
  }

  /// A fresh set-password link for an existing staff member -- for an
  /// invite that expired or got lost, or someone locked out of their
  /// account.
  Future<String> reissueInviteLink(String staffId) async {
    final json =
        await _post('/staff/$staffId/invite-link', {}) as Map<String, dynamic>;
    return json['invite_link'] as String;
  }

  Future<void> updateStaff(String id, {String? role, bool? isActive}) async {
    await _patch('/staff/$id', {
      if (role != null) 'role': role,
      if (isActive != null) 'is_active': isActive,
    });
  }

  // ---------- categories ----------

  Future<List<Category>> listCategories() async =>
      (await _get('/categories') as List)
          .map((e) => Category.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<Category> createCategory({
    required String name,
    required String slug,
    String? description,
    int displayOrder = 0,
  }) async => Category.fromJson(
    await _post('/categories', {
          'name': name,
          'slug': slug,
          if (description != null && description.isNotEmpty)
            'description': description,
          'display_order': displayOrder,
        })
        as Map<String, dynamic>,
  );

  Future<Category> updateCategory(
    String id,
    Map<String, dynamic> fields,
  ) async => Category.fromJson(
    await _patch('/categories/$id', fields) as Map<String, dynamic>,
  );

  Future<void> deleteCategory(String id) => _delete('/categories/$id');

  // ---------- products ----------

  Future<List<Product>> listProducts({
    String? search,
    String? status,
    String? categoryId,
  }) async =>
      (await _get('/products', {
                if (search != null && search.isNotEmpty) 'search': search,
                if (status != null) 'status': status,
                if (categoryId != null) 'category_id': categoryId,
              })
              as List)
          .map((e) => Product.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<Product> getProduct(String id) async =>
      Product.fromJson(await _get('/products/$id') as Map<String, dynamic>);

  Future<Product> createProduct({
    required String name,
    required String slug,
    required String categoryId,
    required double basePrice,
    String? brand,
  }) async => Product.fromJson(
    await _post('/products', {
          'name': name,
          'slug': slug,
          'category_id': categoryId,
          'base_price': basePrice,
          if (brand != null && brand.isNotEmpty) 'brand': brand,
        })
        as Map<String, dynamic>,
  );

  Future<Product> updateProduct(String id, Map<String, dynamic> fields) async =>
      Product.fromJson(
        await _patch('/products/$id', fields) as Map<String, dynamic>,
      );

  Future<void> archiveProduct(String id) =>
      updateProduct(id, {'status': 'archived'});

  Future<void> activateProduct(String id) =>
      updateProduct(id, {'status': 'active'});

  Future<void> deleteProduct(String id) => _delete('/products/$id');

  // Goods arriving at the counter, in one request -- see receive_stock in
  // services/api/app/routers/products.py. Without productId this creates
  // a brand-new draft item (imageStoragePath from uploadIntakePhoto
  // below); with it, it adds stock to that existing product's matching
  // size/color, creating that variant if it's new.
  Future<({Product product, ProductVariant variant})> receiveStock({
    String? productId,
    String? name,
    String? imageStoragePath,
    required int quantity,
    String? categoryId,
    double? basePrice,
    String? size,
    String? color,
  }) async {
    final json =
        await _post('/products/receive', {
              if (productId != null) 'product_id': productId,
              if (name != null) 'name': name,
              if (imageStoragePath != null)
                'image_storage_path': imageStoragePath,
              'quantity': quantity,
              if (categoryId != null) 'category_id': categoryId,
              if (basePrice != null) 'base_price': basePrice,
              if (size != null && size.isNotEmpty) 'size': size,
              if (color != null && color.isNotEmpty) 'color': color,
            })
            as Map<String, dynamic>;
    return (
      product: Product.fromJson(json['product'] as Map<String, dynamic>),
      variant: ProductVariant.fromJson(json['variant'] as Map<String, dynamic>),
    );
  }

  // ---------- product images ----------
  //
  // The file bytes go to the API (POST /uploads/product-photo), which puts
  // them in the photo bucket and returns a storage path; attaching that
  // path to a product is a separate call. See
  // services/api/app/routers/uploads.py for why photos go through the API
  // rather than straight to the bucket.

  static const _photoContentTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
  };

  /// Uploads a photo and returns its storage path. Anything the picker
  /// hands back with an unrecognized extension is sent as JPEG, which is
  /// what image_picker produces when it re-compresses (imageQuality < 100).
  Future<String> _uploadPhoto(Uint8List bytes, String fileExtension) async {
    final contentType =
        _photoContentTypes[fileExtension.toLowerCase()] ?? 'image/jpeg';
    final json =
        await _http.postFile(
              '/uploads/product-photo',
              field: 'file',
              bytes: bytes,
              filename: 'photo.$fileExtension',
              contentType: contentType,
            )
            as Map<String, dynamic>;
    return json['storage_path'] as String;
  }

  /// For receiveStock: the photo is taken before the product exists, so
  /// it's uploaded on its own the moment it's picked, and its path is sent
  /// along with the rest of the item afterward -- which keeps saving the
  /// item itself a single quick request.
  Future<String> uploadIntakePhoto({
    required Uint8List bytes,
    required String fileExtension,
  }) => _uploadPhoto(bytes, fileExtension);

  Future<ProductImage> uploadProductImage({
    required String productId,
    required Uint8List bytes,
    required String fileExtension,
    bool isPrimary = false,
  }) async {
    final path = await _uploadPhoto(bytes, fileExtension);

    return ProductImage.fromJson(
      await _post('/products/$productId/images', {
            'storage_path': path,
            'is_primary': isPrimary,
          })
          as Map<String, dynamic>,
    );
  }

  Future<void> setPrimaryImage(String imageId) =>
      _patch('/images/$imageId', {});

  Future<void> deleteProductImage(String imageId) =>
      _delete('/images/$imageId');

  // ---------- variants ----------

  // SKU is deliberately not a parameter here -- the backend generates one
  // from the product + size + color so nobody has to invent a unique code.
  Future<ProductVariant> createVariant(
    String productId, {
    required String size,
    String? color,
    double? priceOverride,
    double? wholesalePrice,
    double? packPrice,
    int? packSize,
  }) async => ProductVariant.fromJson(
    await _post('/products/$productId/variants', {
          'size': size,
          if (color != null && color.isNotEmpty) 'color': color,
          if (priceOverride != null) 'price_override': priceOverride,
          if (wholesalePrice != null) 'wholesale_price': wholesalePrice,
          if (packPrice != null) 'pack_price': packPrice,
          if (packSize != null) 'pack_size': packSize,
        })
        as Map<String, dynamic>,
  );

  Future<ProductVariant> updateVariant(
    String id,
    Map<String, dynamic> fields,
  ) async => ProductVariant.fromJson(
    await _patch('/variants/$id', fields) as Map<String, dynamic>,
  );

  Future<List<LowStockVariant>> lowStockVariants() async =>
      (await _get('/variants/low-stock') as List)
          .map((e) => LowStockVariant.fromJson(e as Map<String, dynamic>))
          .toList();

  // ---------- stock movements ----------

  Future<StockMovement> createStockMovement({
    required String variantId,
    required String movementType,
    required int quantityChange,
    String? reason,
    String? referenceType,
    String? referenceId,
  }) async => StockMovement.fromJson(
    await _post('/stock-movements', {
          'variant_id': variantId,
          'movement_type': movementType,
          'quantity_change': quantityChange,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
          if (referenceType != null) 'reference_type': referenceType,
          if (referenceId != null) 'reference_id': referenceId,
        })
        as Map<String, dynamic>,
  );

  Future<List<StockMovement>> listStockMovements({
    String? variantId,
    int limit = 50,
  }) async =>
      (await _get('/stock-movements', {
                if (variantId != null) 'variant_id': variantId,
                'limit': '$limit',
              })
              as List)
          .map((e) => StockMovement.fromJson(e as Map<String, dynamic>))
          .toList();

  // ---------- audit log ----------

  Future<List<AuditLogEntry>> auditLog({
    required String tableName,
    String? recordId,
  }) async =>
      (await _get('/audit-log', {
                'table_name': tableName,
                if (recordId != null) 'record_id': recordId,
              })
              as List)
          .map((e) => AuditLogEntry.fromJson(e as Map<String, dynamic>))
          .toList();

  // ---------- pos sales ----------

  Future<List<PosSale>> listPosSales({int limit = 100}) async =>
      (await _get('/pos-sales', {'limit': '$limit'}) as List)
          .map((e) => PosSale.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<PosSale> createPosSale({
    String? customerId,
    required List<Map<String, dynamic>> items,
    required List<Map<String, dynamic>> payments,
  }) async => PosSale.fromJson(
    await _post('/pos-sales', {
          if (customerId != null) 'customer_id': customerId,
          'items': items,
          'payments': payments,
        })
        as Map<String, dynamic>,
  );

  Future<PosSale> voidPosSale(String id) async => PosSale.fromJson(
    await _post('/pos-sales/$id/void', {}) as Map<String, dynamic>,
  );

  Future<PosSale> identifyPosSaleItem(
    String saleId,
    String itemId, {
    required String variantId,
  }) async => PosSale.fromJson(
    await _post('/pos-sales/$saleId/items/$itemId/identify', {
          'variant_id': variantId,
        })
        as Map<String, dynamic>,
  );

  // ---------- reports ----------

  Future<List<DailySales>> dailySales({int days = 30}) async =>
      (await _get('/reports/daily-sales', {'days': '$days'}) as List)
          .map((e) => DailySales.fromJson(e as Map<String, dynamic>))
          .toList();

  // ---------- orders ----------

  Future<List<Order>> listOrders({String? status}) async =>
      (await _get('/orders', {if (status != null) 'status': status}) as List)
          .map((e) => Order.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<List<Order>> ordersNeedingAttention() async =>
      (await _get('/orders/needs-attention') as List)
          .map((e) => Order.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<Order> updateOrderStatus(
    String id,
    String status, {
    String? note,
  }) async => Order.fromJson(
    await _post('/orders/$id/status', {
          'status': status,
          if (note != null && note.isNotEmpty) 'note': note,
        })
        as Map<String, dynamic>,
  );

  // ---------- customers ----------

  Future<List<Customer>> listCustomers({
    String? status,
    String? customerType,
  }) async =>
      (await _get('/customers', {
                if (status != null) 'status': status,
                if (customerType != null) 'customer_type': customerType,
              })
              as List)
          .map((e) => Customer.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<Customer> getCustomer(String id) async =>
      Customer.fromJson(await _get('/customers/$id') as Map<String, dynamic>);

  Future<Customer> createCustomer({
    required String fullName,
    required String email,
    String? phone,
    String customerType = 'retail',
    String? businessName,
    double creditLimit = 0,
  }) async => Customer.fromJson(
    await _post('/customers', {
          'full_name': fullName,
          'email': email,
          if (phone != null && phone.isNotEmpty) 'phone': phone,
          'customer_type': customerType,
          if (businessName != null && businessName.isNotEmpty)
            'business_name': businessName,
          'credit_limit': creditLimit,
        })
        as Map<String, dynamic>,
  );

  Future<Customer> updateCustomer(
    String id,
    Map<String, dynamic> fields,
  ) async => Customer.fromJson(
    await _patch('/customers/$id', fields) as Map<String, dynamic>,
  );

  Future<Customer> updateCustomerStatus(String id, String status) async =>
      Customer.fromJson(
        await _post('/customers/$id/status', {'status': status})
            as Map<String, dynamic>,
      );

  // ---------- wholesale credit ----------

  Future<List<CreditLedgerEntry>> listCreditLedger(String customerId) async =>
      (await _get('/customers/$customerId/credit-ledger') as List)
          .map((e) => CreditLedgerEntry.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<CreditLedgerEntry> recordCreditPayment(
    String customerId, {
    required double amount,
    String? reason,
  }) async => CreditLedgerEntry.fromJson(
    await _post('/customers/$customerId/credit-payments', {
          'amount': amount,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        })
        as Map<String, dynamic>,
  );

  Future<CreditLedgerEntry> recordCreditAdjustment(
    String customerId, {
    required double amount,
    required String reason,
  }) async => CreditLedgerEntry.fromJson(
    await _post('/customers/$customerId/credit-adjustments', {
          'amount': amount,
          'reason': reason,
        })
        as Map<String, dynamic>,
  );

  // ---------- dashboard ----------

  Future<Dashboard> getDashboard({int days = 30}) async => Dashboard.fromJson(
    await _get('/reports/dashboard', {'days': '$days'}) as Map<String, dynamic>,
  );

  // ---------- inventory ----------

  Future<void> rebalanceInventory({
    required List<Map<String, dynamic>> lines,
    String? note,
  }) async {
    await _post('/inventory/rebalance', {
      'lines': lines,
      if (note != null && note.isNotEmpty) 'note': note,
    });
  }
}
