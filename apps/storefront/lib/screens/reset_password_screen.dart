import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../auth_controller.dart';
import '../theme.dart';
import '../widgets/storefront_scaffold.dart';

/// Where a customer's password-reset email lands
/// (`https://belpok.xyz/#/reset-password?token=...` -- see
/// services/api/app/routers/auth.py's create_one_time_link). Choosing a
/// new password here also signs them in, then takes them to their account.
class ResetPasswordScreen extends StatefulWidget {
  /// Null if someone opens the route without a link -- shown as an
  /// expired link rather than a form that can't work.
  final String? token;
  const ResetPasswordScreen({super.key, required this.token});

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit(AuthController auth) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _submitting = true);
    final ok = await auth.resetPassword(
      widget.token!,
      _passwordController.text,
    );
    if (!mounted) return;
    setState(() => _submitting = false);
    if (ok) context.go('/account');
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final token = widget.token;

    return StorefrontScaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: token == null
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        "This reset link isn't complete. Request a new one "
                        'from the sign-in page.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: () => context.go('/login'),
                        child: const Text('Go to sign in'),
                      ),
                    ],
                  )
                : Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Choose a new password',
                          style: Theme.of(context).textTheme.headlineSmall,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 24),
                        TextFormField(
                          controller: _passwordController,
                          autofocus: true,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: 'New password',
                          ),
                          // The API's own rule (services/api/app/schemas.py).
                          validator: (v) => (v == null || v.length < 8)
                              ? 'At least 8 characters'
                              : null,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _confirmController,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: 'Confirm new password',
                          ),
                          validator: (v) => v != _passwordController.text
                              ? "Passwords don't match"
                              : null,
                        ),
                        if (auth.error != null) ...[
                          const SizedBox(height: 12),
                          Text(
                            auth.error!,
                            style: const TextStyle(
                              color: StorefrontColors.danger,
                            ),
                          ),
                        ],
                        const SizedBox(height: 20),
                        FilledButton(
                          onPressed: _submitting ? null : () => _submit(auth),
                          child: const Text('Save and sign in'),
                        ),
                      ],
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}
