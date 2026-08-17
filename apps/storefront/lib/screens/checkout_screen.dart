import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../cart.dart';
import '../theme.dart';
import '../widgets/storefront_scaffold.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _api = StorefrontApiClient();
  final _formKey = GlobalKey<FormState>();

  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _line1Controller = TextEditingController();
  final _line2Controller = TextEditingController();
  final _cityController = TextEditingController();
  final _stateController = TextEditingController();
  final _postalController = TextEditingController();
  final _countryController = TextEditingController(text: 'Ghana');
  final _notesController = TextEditingController();

  List<Address> _savedAddresses = [];
  String? _selectedAddressId;
  bool _loadingAddresses = false;
  bool _submitting = false;
  String? _error;

  bool get _signedIn =>
      context.read<AuthController>().status == AuthStatus.signedIn;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeLoadAddresses());
  }

  Future<void> _maybeLoadAddresses() async {
    if (!_signedIn) return;
    setState(() => _loadingAddresses = true);
    try {
      final addresses = await _api.listMyAddresses();
      setState(() {
        _savedAddresses = addresses;
        _selectedAddressId =
            addresses.where((a) => a.isDefault).firstOrNull?.id ??
            addresses.firstOrNull?.id;
        _loadingAddresses = false;
      });
    } on ApiException {
      setState(() => _loadingAddresses = false);
    }
  }

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _line1Controller.dispose();
    _line2Controller.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _postalController.dispose();
    _countryController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _placeOrder() async {
    final cart = context.read<CartController>();
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_signedIn &&
        _selectedAddressId == null &&
        _line1Controller.text.trim().isEmpty) {
      setState(() => _error = 'Choose a saved address or enter a new one.');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final order = await _api.checkout(
        itemsByVariantId: cart.quantitiesByVariantId,
        guestFullName: _signedIn ? null : _fullNameController.text.trim(),
        guestEmail: _signedIn ? null : _emailController.text.trim(),
        guestPhone: _signedIn ? null : _phoneController.text.trim(),
        addressId: _signedIn && _selectedAddressId != null
            ? _selectedAddressId
            : null,
        newAddress: (!_signedIn || _selectedAddressId == null)
            ? {
                'line1': _line1Controller.text.trim(),
                if (_line2Controller.text.trim().isNotEmpty)
                  'line2': _line2Controller.text.trim(),
                'city': _cityController.text.trim(),
                if (_stateController.text.trim().isNotEmpty)
                  'state': _stateController.text.trim(),
                if (_postalController.text.trim().isNotEmpty)
                  'postal_code': _postalController.text.trim(),
                'country': _countryController.text.trim(),
              }
            : null,
        notes: _notesController.text.trim().isEmpty
            ? null
            : _notesController.text.trim(),
      );
      if (!mounted) return;
      cart.clear();
      context.go('/order-confirmation', extra: order);
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartController>();

    if (cart.isEmpty) {
      return StorefrontScaffold(
        showBackButton: true,
        body: const Center(child: Text('Your cart is empty.')),
      );
    }

    return StorefrontScaffold(
      showBackButton: true,
      body: Form(
        key: _formKey,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Checkout',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 16),
                if (!_signedIn) ..._buildGuestContactFields(),
                Text(
                  'Shipping address',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                if (_signedIn) ..._buildAddressPicker(),
                if (!_signedIn || _selectedAddressId == null)
                  ..._buildNewAddressFields(),
                const SizedBox(height: 8),
                TextFormField(
                  controller: _notesController,
                  decoration: const InputDecoration(
                    labelText: 'Order notes (optional)',
                  ),
                  maxLines: 2,
                ),
                const SizedBox(height: 20),
                _OrderSummary(cart: cart),
                const SizedBox(height: 20),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: StorefrontColors.danger),
                    ),
                  ),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _submitting ? null : _placeOrder,
                    child: _submitting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(
                            'Place order · ₵${cart.total.toStringAsFixed(2)}',
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _buildGuestContactFields() {
    return [
      Text('Contact details', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      TextFormField(
        controller: _fullNameController,
        decoration: const InputDecoration(labelText: 'Full name'),
        validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
      ),
      const SizedBox(height: 12),
      TextFormField(
        controller: _emailController,
        decoration: const InputDecoration(labelText: 'Email'),
        keyboardType: TextInputType.emailAddress,
        validator: (v) =>
            (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
      ),
      const SizedBox(height: 12),
      TextFormField(
        controller: _phoneController,
        decoration: const InputDecoration(labelText: 'Phone (optional)'),
        keyboardType: TextInputType.phone,
      ),
      const SizedBox(height: 20),
    ];
  }

  List<Widget> _buildAddressPicker() {
    if (_loadingAddresses) {
      return const [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: LinearProgressIndicator(),
        ),
      ];
    }
    if (_savedAddresses.isEmpty) return const [];
    return [
      RadioGroup<String?>(
        groupValue: _selectedAddressId,
        onChanged: (value) => setState(() => _selectedAddressId = value),
        child: Column(
          children: [
            ..._savedAddresses.map(
              (address) => RadioListTile<String>(
                contentPadding: EdgeInsets.zero,
                value: address.id,
                title: Text(address.label),
                subtitle: Text(address.oneLine),
              ),
            ),
            const RadioListTile<String?>(
              contentPadding: EdgeInsets.zero,
              value: null,
              title: Text('Use a new address'),
            ),
          ],
        ),
      ),
      const SizedBox(height: 8),
    ];
  }

  List<Widget> _buildNewAddressFields() {
    return [
      TextFormField(
        controller: _line1Controller,
        decoration: const InputDecoration(labelText: 'Address line 1'),
        validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
      ),
      const SizedBox(height: 12),
      TextFormField(
        controller: _line2Controller,
        decoration: const InputDecoration(
          labelText: 'Address line 2 (optional)',
        ),
      ),
      const SizedBox(height: 12),
      Row(
        children: [
          Expanded(
            child: TextFormField(
              controller: _cityController,
              decoration: const InputDecoration(labelText: 'City'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextFormField(
              controller: _stateController,
              decoration: const InputDecoration(
                labelText: 'Region/State (optional)',
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),
      Row(
        children: [
          Expanded(
            child: TextFormField(
              controller: _postalController,
              decoration: const InputDecoration(
                labelText: 'Postal code (optional)',
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextFormField(
              controller: _countryController,
              decoration: const InputDecoration(labelText: 'Country'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
          ),
        ],
      ),
      const SizedBox(height: 8),
    ];
  }
}

class _OrderSummary extends StatelessWidget {
  final CartController cart;

  const _OrderSummary({required this.cart});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Order summary',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            ...cart.lines.map(
              (line) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text('${line.product.name} × ${line.quantity}'),
                    ),
                    Text('₵${line.lineTotal.toStringAsFixed(2)}'),
                  ],
                ),
              ),
            ),
            const Divider(height: 20),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Total',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                Text(
                  '₵${cart.total.toStringAsFixed(2)}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
