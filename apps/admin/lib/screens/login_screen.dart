import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../auth_controller.dart';
import '../theme.dart';
import '../widgets/forgot_password_dialog.dart';

/// Email/password sign-in for staff. A valid Supabase login with no
/// matching `staff` row shows an explanatory message (AuthStatus.notStaff)
/// rather than a generic error -- see AuthController's class doc comment.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _submitting = false;

  Future<void> _submit(AuthController auth) async {
    setState(() => _submitting = true);
    await auth.signIn(_emailController.text.trim(), _passwordController.text);
    if (mounted) setState(() => _submitting = false);
  }

  void _forgotPassword(AuthController auth) {
    showDialog(
      context: context,
      builder: (_) => ForgotPasswordDialog(
        auth: auth,
        initialEmail: _emailController.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Scaffold(
      backgroundColor: AppColors.navy,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.amber,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Icon(
                      Icons.storefront,
                      color: Colors.white,
                      size: 30,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Belin-Pok Enterprise',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Sign in to the admin dashboard',
                    style: TextStyle(color: AppColors.inkMuted),
                  ),
                  const SizedBox(height: 28),
                  if (auth.status == AuthStatus.notStaff)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 16),
                      child: Text(
                        "This account isn't set up as staff yet. Ask an owner to invite you.",
                        style: TextStyle(color: AppColors.danger),
                      ),
                    ),
                  if (auth.error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        auth.error!,
                        style: const TextStyle(color: AppColors.danger),
                      ),
                    ),
                  TextField(
                    controller: _emailController,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      prefixIcon: Icon(Icons.mail_outline),
                    ),
                    keyboardType: TextInputType.emailAddress,
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _passwordController,
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      prefixIcon: Icon(Icons.lock_outline),
                    ),
                    obscureText: true,
                    onSubmitted: (_) => _submitting ? null : _submit(auth),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: () => _forgotPassword(auth),
                      child: const Text('Forgot password?'),
                    ),
                  ),
                  const SizedBox(height: 8),
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
                        : const Text('Sign In'),
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
