import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';

class StaffScreen extends StatefulWidget {
  const StaffScreen({super.key});

  @override
  State<StaffScreen> createState() => _StaffScreenState();
}

class _StaffScreenState extends State<StaffScreen> {
  final _api = ApiClient();
  List<StaffProfile> _staff = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final staff = await _api.listStaff();
      setState(() => _staff = staff);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _openInviteDialog() async {
    final invited = await showDialog<bool>(
      context: context,
      builder: (_) => _InviteStaffDialog(api: _api),
    );
    if (invited == true) _load();
  }

  Future<void> _changeRole(StaffProfile staff, String role) async {
    await _api.updateStaff(staff.id, role: role);
    _load();
  }

  Future<void> _toggleActive(StaffProfile staff) async {
    await _api.updateStaff(staff.id, isActive: !staff.isActive);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Staff'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openInviteDialog,
        icon: const Icon(Icons.person_add),
        label: const Text('Invite staff'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text('Error: $_error'))
          : ListView.separated(
              itemCount: _staff.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final staff = _staff[index];
                return ListTile(
                  title: Text(staff.fullName),
                  subtitle: Text(staff.email),
                  leading: CircleAvatar(
                    child: Text(
                      staff.fullName.isNotEmpty
                          ? staff.fullName[0].toUpperCase()
                          : '?',
                    ),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      DropdownButton<String>(
                        value: staff.role,
                        items: kStaffRoles
                            .map(
                              (r) => DropdownMenuItem(value: r, child: Text(r)),
                            )
                            .toList(),
                        onChanged: (v) =>
                            v == null ? null : _changeRole(staff, v),
                      ),
                      const SizedBox(width: 8),
                      Switch(
                        value: staff.isActive,
                        onChanged: (_) => _toggleActive(staff),
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}

class _InviteStaffDialog extends StatefulWidget {
  final ApiClient api;
  const _InviteStaffDialog({required this.api});

  @override
  State<_InviteStaffDialog> createState() => _InviteStaffDialogState();
}

class _InviteStaffDialogState extends State<_InviteStaffDialog> {
  final _emailController = TextEditingController();
  final _nameController = TextEditingController();
  String _role = 'viewer';
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (_emailController.text.trim().isEmpty ||
        _nameController.text.trim().isEmpty) {
      setState(() => _error = 'Name and email are required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.inviteStaff(
        email: _emailController.text.trim(),
        fullName: _nameController.text.trim(),
        role: _role,
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Invite staff'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(labelText: 'Full name'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _emailController,
            decoration: const InputDecoration(labelText: 'Email'),
            keyboardType: TextInputType.emailAddress,
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _role,
            decoration: const InputDecoration(labelText: 'Role'),
            items: kStaffRoles
                .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                .toList(),
            onChanged: (v) => setState(() => _role = v!),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: const Text('Send invite'),
        ),
      ],
    );
  }
}
