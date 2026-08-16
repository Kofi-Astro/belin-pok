import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'models.dart';

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
}

/// Thin wrapper around the FastAPI backend. Every call attaches the current
/// Supabase session's access token as a Bearer token -- the backend
/// verifies it and resolves it to a `staff` row (see services/api/app/deps.py).
class ApiClient {
  final _baseUrl = AppConfig.apiBaseUrl;

  Map<String, String> get _headers {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<dynamic> _get(String path, [Map<String, String>? query]) async {
    final uri = Uri.parse('$_baseUrl$path').replace(queryParameters: query);
    final response = await http.get(uri, headers: _headers);
    return _decode(response);
  }

  Future<dynamic> _post(String path, Map<String, dynamic> body) async {
    final response = await http.post(
      Uri.parse('$_baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Future<dynamic> _patch(String path, Map<String, dynamic> body) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  dynamic _decode(http.Response response) {
    if (response.statusCode >= 400) {
      String detail = response.body;
      try {
        detail =
            (jsonDecode(response.body) as Map<String, dynamic>)['detail']
                ?.toString() ??
            response.body;
      } catch (_) {}
      throw ApiException(response.statusCode, detail);
    }
    if (response.body.isEmpty) return null;
    return jsonDecode(response.body);
  }

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

  // ---------- variants ----------

  Future<ProductVariant> createVariant(
    String productId, {
    required String sku,
    required String size,
    String? color,
    double? priceOverride,
  }) async => ProductVariant.fromJson(
    await _post('/products/$productId/variants', {
          'sku': sku,
          'size': size,
          if (color != null && color.isNotEmpty) 'color': color,
          if (priceOverride != null) 'price_override': priceOverride,
        })
        as Map<String, dynamic>,
  );

  Future<List<ProductVariant>> lowStockVariants() async =>
      (await _get('/variants/low-stock') as List)
          .map((e) => ProductVariant.fromJson(e as Map<String, dynamic>))
          .toList();

  // ---------- stock movements ----------

  Future<void> createStockMovement({
    required String variantId,
    required String movementType,
    required int quantityChange,
    String? reason,
  }) async {
    await _post('/stock-movements', {
      'variant_id': variantId,
      'movement_type': movementType,
      'quantity_change': quantityChange,
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    });
  }

  Future<List<StockMovement>> listStockMovements({String? variantId}) async =>
      (await _get('/stock-movements', {
                if (variantId != null) 'variant_id': variantId,
              })
              as List)
          .map((e) => StockMovement.fromJson(e as Map<String, dynamic>))
          .toList();

  // ---------- orders ----------

  Future<List<Order>> listOrders({String? status}) async =>
      (await _get('/orders', {if (status != null) 'status': status}) as List)
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

  Future<List<Customer>> listCustomers({String? status}) async =>
      (await _get('/customers', {if (status != null) 'status': status}) as List)
          .map((e) => Customer.fromJson(e as Map<String, dynamic>))
          .toList();
}
