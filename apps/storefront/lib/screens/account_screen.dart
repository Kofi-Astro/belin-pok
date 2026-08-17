import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../theme.dart';
import '../widgets/storefront_scaffold.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();

    return StorefrontScaffold(
      body: switch (auth.status) {
        AuthStatus.unknown => const Center(child: CircularProgressIndicator()),
        AuthStatus.signedOut => const Center(
          child: Text('Sign in to view your account.'),
        ),
        AuthStatus.needsRegistration => const _CompleteRegistrationForm(),
        AuthStatus.signedIn => const _AccountDetails(),
      },
    );
  }
}

class _CompleteRegistrationForm extends StatefulWidget {
  const _CompleteRegistrationForm();

  @override
  State<_CompleteRegistrationForm> createState() =>
      _CompleteRegistrationFormState();
}

class _CompleteRegistrationFormState extends State<_CompleteRegistrationForm> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _phoneController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _fullNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _submit(AuthController auth) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _submitting = true);
    await auth.completeRegistration(
      fullName: _fullNameController.text.trim(),
      phone: _phoneController.text.trim().isEmpty
          ? null
          : _phoneController.text.trim(),
    );
    if (mounted) setState(() => _submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Finish setting up your account',
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                const Text(
                  'One more step -- tell us your name so we know who\'s ordering.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: StorefrontColors.inkMuted),
                ),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _fullNameController,
                  decoration: const InputDecoration(labelText: 'Full name'),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _phoneController,
                  decoration: const InputDecoration(
                    labelText: 'Phone (optional)',
                  ),
                  keyboardType: TextInputType.phone,
                ),
                if (auth.error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    auth.error!,
                    style: const TextStyle(color: StorefrontColors.danger),
                  ),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _submitting ? null : () => _submit(auth),
                  child: _submitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Continue'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AccountDetails extends StatefulWidget {
  const _AccountDetails();

  @override
  State<_AccountDetails> createState() => _AccountDetailsState();
}

class _AccountDetailsState extends State<_AccountDetails> {
  final _api = StorefrontApiClient();
  List<Order>? _orders;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<void> _loadOrders() async {
    try {
      final orders = await _api.listMyOrders();
      if (mounted) setState(() => _orders = orders);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final profile = auth.profile;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Your account',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            if (profile != null) ...[
              Text(
                profile.fullName,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              Text(
                profile.email,
                style: const TextStyle(color: StorefrontColors.inkMuted),
              ),
            ],
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: auth.signOut,
                child: const Text('Sign out'),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'Order history',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            if (_error != null)
              Text(
                _error!,
                style: const TextStyle(color: StorefrontColors.danger),
              )
            else if (_orders == null)
              const Center(child: CircularProgressIndicator())
            else if (_orders!.isEmpty)
              const Text(
                'No orders yet.',
                style: TextStyle(color: StorefrontColors.inkMuted),
              )
            else
              ..._orders!.map(
                (order) => Card(
                  child: ListTile(
                    title: Text(order.orderNumber),
                    subtitle: Text(
                      '${order.items.length} item(s) · ${order.status}',
                    ),
                    trailing: Text(
                      '₵${order.total.toStringAsFixed(2)}',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
