/// Shared shapes (Category, Product, ProductVariant, ProductImage, Order,
/// OrderItem, Address) live in belpok_core -- see apps/storefront's
/// pubspec.yaml. Customer stays local: it's the same CustomerRead API
/// shape admin's Customer class parses, but admin only ever displays a
/// staff-facing subset (no phone) while the storefront's own account
/// screen needs the shopper-facing fields -- forcing one shared shape
/// isn't worth it for a handful of fields that differ by audience.
class Customer {
  final String id;
  final String fullName;
  final String email;
  final String? phone;
  final String customerType;
  final String status;

  Customer({
    required this.id,
    required this.fullName,
    required this.email,
    required this.phone,
    required this.customerType,
    required this.status,
  });

  factory Customer.fromJson(Map<String, dynamic> json) => Customer(
    id: json['id'] as String,
    fullName: json['full_name'] as String,
    email: json['email'] as String,
    phone: json['phone'] as String?,
    customerType: json['customer_type'] as String,
    status: json['status'] as String,
  );
}
