import 'dart:typed_data';

import 'package:belpok_core/belpok_core.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'models.dart';

export 'package:belpok_core/belpok_core.dart' show ApiException;

/// Thin wrapper around the FastAPI backend. Every call attaches the current
/// Supabase session's access token as a Bearer token -- the backend
/// verifies it and resolves it to a `staff` row (see services/api/app/deps.py).
class ApiClient {
  final ApiHttp _http = ApiHttp(
    baseUrl: AppConfig.apiBaseUrl,
    headers: () {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      return {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };
    },
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

  Future<void> inviteStaff({
    required String email,
    required String fullName,
    required String role,
  }) async {
    await _post('/staff/invite', {
      'email': email,
      'full_name': fullName,
      'role': role,
    });
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

  // ---------- product images ----------
  //
  // The file bytes go straight to Supabase Storage using the signed-in
  // staff member's own session (respects the storage.objects RLS policies
  // in supabase/migrations); only the resulting path is registered with
  // the API, which is what every other admin/tablet actually reads back.

  Future<ProductImage> uploadProductImage({
    required String productId,
    required Uint8List bytes,
    required String fileExtension,
    bool isPrimary = false,
  }) async {
    final path =
        'products/$productId/${DateTime.now().microsecondsSinceEpoch}.$fileExtension';
    await Supabase.instance.client.storage
        .from('product-images')
        .uploadBinary(
          path,
          bytes,
          fileOptions: const FileOptions(upsert: false),
        );

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

  Future<PosSale> voidPosSale(String id) async =>
      PosSale.fromJson(await _post('/pos-sales/$id/void', {}) as Map<String, dynamic>);

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
          if (businessName != null && businessName.isNotEmpty) 'business_name': businessName,
          'credit_limit': creditLimit,
        })
        as Map<String, dynamic>,
  );

  Future<Customer> updateCustomer(String id, Map<String, dynamic> fields) async =>
      Customer.fromJson(
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
