import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

String _roleLabel(String role) =>
    role.split('_').map((w) => w[0].toUpperCase() + w.substring(1)).join(' ');

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
    final myId = context.watch<AuthController>().profile?.id;
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
        label: const Text('Invite Staff'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text('Error: $_error'))
          : _staff.isEmpty
          ? const EmptyState(
              icon: Icons.people_outline,
              title: 'No staff yet',
              message:
                  'Tap "Invite Staff" below to bring someone else onto the team.',
            )
          : ListView.builder(
              padding: const EdgeInsets.all(20),
              itemCount: _staff.length,
              itemBuilder: (context, index) {
                final staff = _staff[index];
                return _StaffCard(
                  staff: staff,
                  isSelf: staff.id == myId,
                  onChangeRole: (role) => _changeRole(staff, role),
                  onToggleActive: () => _toggleActive(staff),
                );
              },
            ),
    );
  }
}

/// One staff member's row. On a wide screen this fits on one line; on a
/// narrow one (a phone's browser, not just a small window) the name/email
/// and the role/active controls stack instead of squeezing into a
/// ListTile's trailing slot, which is what was overflowing/truncating
/// badly on mobile web before.
class _StaffCard extends StatelessWidget {
  final StaffProfile staff;
  final bool isSelf;
  final ValueChanged<String> onChangeRole;
  final VoidCallback onToggleActive;

  const _StaffCard({
    required this.staff,
    required this.isSelf,
    required this.onChangeRole,
    required this.onToggleActive,
  });

  @override
  Widget build(BuildContext context) {
    final identity = Row(
      children: [
        CircleAvatar(
          backgroundColor: AppColors.navy,
          child: Text(
            staff.fullName.isNotEmpty ? staff.fullName[0].toUpperCase() : '?',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                staff.fullName,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              Text(
                staff.email,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.inkMuted,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ],
    );

    final controls = Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 4,
      children: [
        DropdownButton<String>(
          value: staff.role,
          underline: const SizedBox(),
          items: kStaffRoles
              .map(
                (r) => DropdownMenuItem(value: r, child: Text(_roleLabel(r))),
              )
              .toList(),
          onChanged: isSelf ? null : (v) => v == null ? null : onChangeRole(v),
        ),
        Tooltip(
          message: isSelf ? "You can't deactivate your own account" : '',
          child: Switch(
            value: staff.isActive,
            activeTrackColor: AppColors.amber,
            onChanged: isSelf ? null : (_) => onToggleActive(),
          ),
        ),
      ],
    );

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: LayoutBuilder(
          builder: (context, constraints) {
            // Roughly enough room for both the identity block and the
            // controls on one line without either getting squeezed.
            if (constraints.maxWidth >= 480) {
              return Row(
                children: [
                  Expanded(child: identity),
                  const SizedBox(width: 12),
                  controls,
                ],
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                identity,
                const SizedBox(height: 8),
                controls,
              ],
            );
          },
        ),
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
              child: Text(
                _error!,
                style: const TextStyle(color: AppColors.danger),
              ),
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
                .map(
                  (r) => DropdownMenuItem(value: r, child: Text(_roleLabel(r))),
                )
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
