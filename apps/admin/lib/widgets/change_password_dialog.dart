import 'package:flutter/material.dart';

import '../auth_controller.dart';
import '../theme.dart';

/// Lets a signed-in user set a new password for their own account, without
/// needing their current one -- the active Supabase session already proves
/// who they are.
class ChangePasswordDialog extends StatefulWidget {
  final AuthController auth;
  const ChangePasswordDialog({super.key, required this.auth});

  @override
  State<ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<ChangePasswordDialog> {
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
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
    final error = await widget.auth.changePassword(newPassword);
    if (!mounted) return;
    if (error != null) {
      setState(() {
        _submitting = false;
        _error = error;
      });
      return;
    }
    Navigator.of(context).pop(true);
  }

  @override
  void dispose() {
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Change password'),
      content: SizedBox(
        width: 340,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger),
                ),
              ),
            TextField(
              controller: _newController,
              autofocus: true,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'New password'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _confirmController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Confirm new password',
              ),
              onSubmitted: (_) => _submitting ? null : _submit(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
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
              : const Text('Save'),
        ),
      ],
    );
  }
}
