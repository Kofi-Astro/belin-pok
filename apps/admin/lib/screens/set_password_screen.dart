import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../auth_controller.dart';
import '../theme.dart';

/// Shown instead of the dashboard right after a password-reset link is
/// redeemed -- the router forces this route whenever
/// `AuthController.passwordRecovery` is true, so nobody lands in the
/// product list still needing to pick a real password.
class SetPasswordScreen extends StatefulWidget {
  const SetPasswordScreen({super.key});

  @override
  State<SetPasswordScreen> createState() => _SetPasswordScreenState();
}

class _SetPasswordScreenState extends State<SetPasswordScreen> {
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _submitting = false;
  String? _error;

  Future<void> _submit(AuthController auth) async {
    final newPassword = _newController.text;
    if (newPassword.length < 6) {
      setState(() => _error = 'Password must be at least 6 characters');
      return;
    }
    if (newPassword != _confirmController.text) {
      setState(() => _error = "Passwords don't match");
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });
    final error = await auth.changePassword(newPassword);
    if (!mounted) return;
    setState(() {
      _submitting = false;
      _error = error;
    });
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
                      Icons.key_outlined,
                      color: Colors.white,
                      size: 30,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Set a new password',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    "You're almost in -- just pick a password.",
                    style: TextStyle(color: AppColors.inkMuted),
                  ),
                  const SizedBox(height: 28),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: AppColors.danger),
                      ),
                    ),
                  TextField(
                    controller: _newController,
                    autofocus: true,
                    decoration: const InputDecoration(
                      labelText: 'New password',
                      prefixIcon: Icon(Icons.lock_outline),
                    ),
                    obscureText: true,
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _confirmController,
                    decoration: const InputDecoration(
                      labelText: 'Confirm new password',
                      prefixIcon: Icon(Icons.lock_outline),
                    ),
                    obscureText: true,
                    onSubmitted: (_) => _submitting ? null : _submit(auth),
                  ),
                  const SizedBox(height: 24),
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
                        : const Text('Save password'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }
}
