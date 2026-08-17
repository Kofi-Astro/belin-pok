import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../auth_controller.dart';
import '../widgets/storefront_scaffold.dart';

/// One screen for both sign-in and sign-up (a toggle, not two routes) --
/// they're the same form shape (email/password) with one extra field and
/// a different verb, not different enough to be worth two screens/routes.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _signUpMode = false;
  bool _submitting = false;
  bool _confirmationSent = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit(AuthController auth) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _submitting = true;
      _confirmationSent = false;
    });
    if (_signUpMode) {
      final hasSession = await auth.signUp(
        _emailController.text.trim(),
        _passwordController.text,
      );
      if (!mounted) return;
      setState(() => _submitting = false);
      if (auth.error != null) return;
      if (hasSession) {
        context.go('/account');
      } else {
        // Email confirmation is required on this Supabase project --
        // there's no session yet, so nothing to navigate to. Say so
        // explicitly instead of silently landing back on a blank form.
        setState(() {
          _confirmationSent = true;
          _signUpMode = false;
        });
      }
    } else {
      await auth.signIn(_emailController.text.trim(), _passwordController.text);
      if (!mounted) return;
      setState(() => _submitting = false);
      if (auth.error == null) context.go('/account');
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();

    return StorefrontScaffold(
      showBackButton: true,
      body: Center(
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
                    _signUpMode ? 'Create an account' : 'Sign in',
                    style: Theme.of(context).textTheme.headlineSmall,
                    textAlign: TextAlign.center,
                  ),
                  if (_confirmationSent) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.success.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Text(
                        'Check your email to confirm your account, then sign in here.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: AppColors.success,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                  TextFormField(
                    controller: _emailController,
                    decoration: const InputDecoration(labelText: 'Email'),
                    keyboardType: TextInputType.emailAddress,
                    validator: (v) => (v == null || !v.contains('@'))
                        ? 'Enter a valid email'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _passwordController,
                    decoration: const InputDecoration(labelText: 'Password'),
                    obscureText: true,
                    validator: (v) => (v == null || v.length < 6)
                        ? 'At least 6 characters'
                        : null,
                  ),
                  if (auth.error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      auth.error!,
                      style: const TextStyle(color: AppColors.danger),
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
                        : Text(_signUpMode ? 'Create account' : 'Sign in'),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => setState(() => _signUpMode = !_signUpMode),
                    child: Text(
                      _signUpMode
                          ? 'Already have an account? Sign in'
                          : 'New here? Create an account',
                    ),
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
