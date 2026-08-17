import 'package:flutter/material.dart';

import '../auth_controller.dart';
import '../theme.dart';

/// Sends a password-reset email. Kept separate from the login form itself
/// since it works regardless of whether the typed-in password was wrong,
/// forgotten entirely, or never set (a staff member who never finished
/// their invite).
class ForgotPasswordDialog extends StatefulWidget {
  final AuthController auth;
  final String initialEmail;
  const ForgotPasswordDialog({
    super.key,
    required this.auth,
    this.initialEmail = '',
  });

  @override
  State<ForgotPasswordDialog> createState() => _ForgotPasswordDialogState();
}

class _ForgotPasswordDialogState extends State<ForgotPasswordDialog> {
  late final _emailController = TextEditingController(
    text: widget.initialEmail,
  );
  bool _submitting = false;
  bool _sent = false;
  String? _error;

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      setState(() => _error = 'Enter a valid email address');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final error = await widget.auth.sendPasswordReset(email);
    if (!mounted) return;
    setState(() {
      _submitting = false;
      if (error != null) {
        _error = error;
      } else {
        _sent = true;
      }
    });
  }

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_sent) {
      return AlertDialog(
        title: const Text('Check your email'),
        content: Text(
          "We've sent a password reset link to ${_emailController.text.trim()}. "
          "Open it on this device to pick a new password.",
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Done'),
          ),
        ],
      );
    }

    return AlertDialog(
      title: const Text('Reset your password'),
      content: SizedBox(
        width: 340,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Enter your email and we'll send you a link to set a new password.",
              style: TextStyle(color: AppColors.inkMuted),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger),
                ),
              ),
            TextField(
              controller: _emailController,
              autofocus: true,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email'),
              onSubmitted: (_) => _submitting ? null : _submit(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Send link'),
        ),
      ],
    );
  }
}
