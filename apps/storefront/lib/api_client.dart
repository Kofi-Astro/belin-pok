import 'package:belpok_core/belpok_core.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'models.dart';

export 'package:belpok_core/belpok_core.dart' show ApiException;

/// Thin wrapper around the FastAPI backend's public/customer-facing
/// routes. Every call attaches the current Supabase session's access
/// token, if there is one -- browsing and guest checkout work fine with
/// none; account/order-history routes need a real one (see
/// services/api/app/deps.py's get_current_customer/get_optional_customer).
class StorefrontApiClient {
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

  // ---------- public browsing ----------

  Future<List<Category>> listCategories() async =>
      (await _http.get('/public/categories') as List)
          .map((e) => Category.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<List<Product>> listProducts({
    String? search,
    String? categoryId,
  }) async =>
      (await _http.get('/public/products', {
                if (search != null && search.isNotEmpty) 'search': search,
                if (categoryId != null) 'category_id': categoryId,
              })
              as List)
          .map((e) => Product.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<Product> getProduct(String id) async => Product.fromJson(
    await _http.get('/public/products/$id') as Map<String, dynamic>,
  );

  // ---------- account ----------

  Future<Customer> registerCustomer({
    required String fullName,
    String? phone,
  }) async => Customer.fromJson(
    await _http.post('/customers/register', {
          'full_name': fullName,
          if (phone != null && phone.isNotEmpty) 'phone': phone,
        })
        as Map<String, dynamic>,
  );

  Future<Customer> getMyProfile() async => Customer.fromJson(
    await _http.get('/customers/me') as Map<String, dynamic>,
  );

  Future<List<Address>> listMyAddresses() async =>
      (await _http.get('/customers/me/addresses') as List)
          .map((e) => Address.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<Address> addMyAddress({
    required String line1,
    String? line2,
    required String city,
    String? state,
    String? postalCode,
    required String country,
    String label = 'Shipping',
  }) async => Address.fromJson(
    await _http.post('/customers/me/addresses', {
          'label': label,
          'line1': line1,
          if (line2 != null && line2.isNotEmpty) 'line2': line2,
          'city': city,
          if (state != null && state.isNotEmpty) 'state': state,
          if (postalCode != null && postalCode.isNotEmpty)
            'postal_code': postalCode,
          'country': country,
        })
        as Map<String, dynamic>,
  );

  // ---------- checkout & orders ----------

  Future<Order> checkout({
    required Map<String, int> itemsByVariantId,
    String? guestFullName,
    String? guestEmail,
    String? guestPhone,
    String? addressId,
    Map<String, dynamic>? newAddress,
    String? notes,
  }) async => Order.fromJson(
    await _http.post('/orders/checkout', {
          'items': itemsByVariantId.entries
              .map((e) => {'variant_id': e.key, 'quantity': e.value})
              .toList(),
          if (guestFullName != null) 'guest_full_name': guestFullName,
          if (guestEmail != null) 'guest_email': guestEmail,
          if (guestPhone != null && guestPhone.isNotEmpty)
            'guest_phone': guestPhone,
          if (addressId != null) 'address_id': addressId,
          if (newAddress != null) 'address': newAddress,
          if (notes != null && notes.isNotEmpty) 'notes': notes,
        })
        as Map<String, dynamic>,
  );

  Future<List<Order>> listMyOrders() async =>
      (await _http.get('/orders/me') as List)
          .map((e) => Order.fromJson(e as Map<String, dynamic>))
          .toList();

  // ---------- push notifications ----------

  Future<void> registerDeviceToken({
    required String platform,
    required String token,
  }) async => await _http.post('/customers/me/device-tokens', {
    'platform': platform,
    'token': token,
  });

  Future<void> unregisterDeviceToken(String token) async =>
      await _http.delete('/customers/me/device-tokens/$token');

  Future<void> subscribeToBackInStock(String variantId) async =>
      await _http.post('/variants/$variantId/notify-when-in-stock', {});
}
