import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';
import '../widgets/status_pill.dart';

/// Retail accounts and wholesale credit accounts, both managed here: create
/// a customer, approve/reject a wholesale signup, set a credit limit, and
/// audit every charge/payment against it. This is the only place staff can
/// set up a wholesale account -- without it, Log Sale's Wholesale Mode has
/// nobody to sell to on credit.
class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});

  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  final _api = ApiClient();
  List<Customer> _customers = [];
  bool _loading = true;
  String? _error;
  String? _typeFilter;
  String? _statusFilter;

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
      final customers = await _api.listCustomers(
        status: _statusFilter,
        customerType: _typeFilter,
      );
      if (mounted) setState(() => _customers = customers);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openAddDialog() async {
    final added = await showDialog<bool>(
      context: context,
      builder: (_) => _CustomerFormDialog(api: _api),
    );
    if (added == true) _load();
  }

  Future<void> _openDetail(Customer customer) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => _CustomerDetailDialog(api: _api, customer: customer),
    );
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final canWrite =
        context.watch<AuthController>().profile?.canManageOrders ?? false;

    return Scaffold(
      appBar: AppBar(title: const Text('Customers')),
      floatingActionButton: canWrite
          ? FloatingActionButton.extended(
              onPressed: _openAddDialog,
              icon: const Icon(Icons.person_add),
              label: const Text('Add Customer'),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _FilterChip(
                  label: 'All',
                  selected: _typeFilter == null,
                  onTap: () => setState(() {
                    _typeFilter = null;
                    _load();
                  }),
                ),
                _FilterChip(
                  label: 'Retail',
                  selected: _typeFilter == 'retail',
                  onTap: () => setState(() {
                    _typeFilter = 'retail';
                    _load();
                  }),
                ),
                _FilterChip(
                  label: 'Wholesale',
                  selected: _typeFilter == 'wholesale',
                  onTap: () => setState(() {
                    _typeFilter = 'wholesale';
                    _load();
                  }),
                ),
                const SizedBox(width: 12),
                _FilterChip(
                  label: 'Pending approval',
                  selected: _statusFilter == 'pending',
                  onTap: () => setState(() {
                    _statusFilter = _statusFilter == 'pending'
                        ? null
                        : 'pending';
                    _load();
                  }),
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                ? Center(child: Text('Error: $_error'))
                : _customers.isEmpty
                ? const EmptyState(
                    icon: Icons.people_outline,
                    title: 'No customers yet',
                    message:
                        'Add a retail or wholesale customer to get started.',
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
                    itemCount: _customers.length,
                    itemBuilder: (context, index) => _CustomerCard(
                      customer: _customers[index],
                      onTap: () => _openDetail(_customers[index]),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => ChoiceChip(
    label: Text(label),
    selected: selected,
    onSelected: (_) => onTap(),
  );
}

class _CustomerCard extends StatelessWidget {
  final Customer customer;
  final VoidCallback onTap;
  const _CustomerCard({required this.customer, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: customer.isWholesale
              ? AppColors.amber
              : AppColors.navy,
          child: Icon(
            customer.isWholesale ? Icons.storefront : Icons.person,
            color: Colors.white,
            size: 20,
          ),
        ),
        title: Text(
          customer.businessName?.isNotEmpty == true
              ? '${customer.businessName} · ${customer.fullName}'
              : customer.fullName,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(customer.email ?? customer.phone ?? 'No contact info'),
        trailing: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            StatusPill(status: customer.status),
            if (customer.isWholesale) ...[
              const SizedBox(height: 6),
              Text(
                '₵${customer.outstandingBalance.toStringAsFixed(2)} owed',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: customer.outstandingBalance > 0
                      ? AppColors.danger
                      : AppColors.inkMuted,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// New-customer creation, retail or wholesale. A wholesale account
/// created here still needs approval (see CustomerStatus in the backend)
/// before it can actually buy on credit.
class _CustomerFormDialog extends StatefulWidget {
  final ApiClient api;
  const _CustomerFormDialog({required this.api});

  @override
  State<_CustomerFormDialog> createState() => _CustomerFormDialogState();
}

class _CustomerFormDialogState extends State<_CustomerFormDialog> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _businessController = TextEditingController();
  final _creditLimitController = TextEditingController(text: '0');
  String _type = 'retail';
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (_nameController.text.trim().isEmpty ||
        _emailController.text.trim().isEmpty) {
      setState(() => _error = 'Name and email are required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.createCustomer(
        fullName: _nameController.text.trim(),
        email: _emailController.text.trim(),
        phone: _phoneController.text.trim(),
        customerType: _type,
        businessName: _businessController.text.trim(),
        creditLimit: double.tryParse(_creditLimitController.text.trim()) ?? 0,
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _businessController.dispose();
    _creditLimitController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add customer'),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger),
                ),
              ),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'retail', label: Text('Retail')),
                ButtonSegment(value: 'wholesale', label: Text('Wholesale')),
              ],
              selected: {_type},
              onSelectionChanged: (s) => setState(() => _type = s.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameController,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Full name'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _emailController,
              decoration: const InputDecoration(labelText: 'Email'),
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _phoneController,
              decoration: const InputDecoration(labelText: 'Phone (optional)'),
            ),
            if (_type == 'wholesale') ...[
              const SizedBox(height: 8),
              TextField(
                controller: _businessController,
                decoration: const InputDecoration(labelText: 'Business name'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _creditLimitController,
                decoration: const InputDecoration(
                  labelText: 'Credit limit (₵)',
                  helperText:
                      'How much this account may owe before sales on credit are blocked.',
                ),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
              ),
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Wholesale accounts start "Pending" until approved -- '
                  'approve it from the customer list once created.',
                  style: TextStyle(fontSize: 12, color: AppColors.inkMuted),
                ),
              ),
            ],
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
              : const Text('Add'),
        ),
      ],
    );
  }
}

/// A customer's full record: edit their details, approve/reject a
/// pending wholesale signup, and -- for a wholesale account -- their
/// full credit ledger (every charge, payment, and manual adjustment)
/// plus a shortcut into _CreditPaymentDialog for recording a paydown.
class _CustomerDetailDialog extends StatefulWidget {
  final ApiClient api;
  final Customer customer;
  const _CustomerDetailDialog({required this.api, required this.customer});

  @override
  State<_CustomerDetailDialog> createState() => _CustomerDetailDialogState();
}

class _CustomerDetailDialogState extends State<_CustomerDetailDialog> {
  late Customer _customer;
  List<CreditLedgerEntry> _ledger = [];
  bool _loadingLedger = true;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _customer = widget.customer;
    if (_customer.isWholesale) _loadLedger();
  }

  Future<void> _loadLedger() async {
    setState(() => _loadingLedger = true);
    try {
      final ledger = await widget.api.listCreditLedger(_customer.id);
      if (mounted) setState(() => _ledger = ledger);
    } on ApiException {
      // Non-critical -- the customer's own balance is already visible.
    } finally {
      if (mounted) setState(() => _loadingLedger = false);
    }
  }

  Future<void> _reloadCustomer() async {
    final fresh = await widget.api.getCustomer(_customer.id);
    if (mounted) setState(() => _customer = fresh);
  }

  Future<void> _setStatus(String status) async {
    try {
      await widget.api.updateCustomerStatus(_customer.id, status);
      _changed = true;
      await _reloadCustomer();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _editCreditLimit() async {
    final controller = TextEditingController(
      text: _customer.creditLimit.toStringAsFixed(2),
    );
    final newLimit = await showDialog<double>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Set credit limit'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Credit limit (₵)'),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(
              context,
            ).pop(double.tryParse(controller.text.trim())),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (newLimit == null) return;
    try {
      await widget.api.updateCustomer(_customer.id, {'credit_limit': newLimit});
      _changed = true;
      await _reloadCustomer();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _recordPayment() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (_) =>
          _CreditPaymentDialog(api: widget.api, customer: _customer),
    );
    if (result == true) {
      _changed = true;
      await _reloadCustomer();
      await _loadLedger();
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = context.watch<AuthController>().profile;
    final canWrite = profile?.canManageOrders ?? false;
    final c = _customer;

    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 640),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      c.fullName,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(_changed),
                  ),
                ],
              ),
              Row(
                children: [
                  StatusPill(status: c.status),
                  const SizedBox(width: 8),
                  Text(c.isWholesale ? 'Wholesale' : 'Retail'),
                ],
              ),
              const SizedBox(height: 4),
              if (c.email != null)
                Text(
                  c.email!,
                  style: const TextStyle(color: AppColors.inkMuted),
                ),
              if (c.phone?.isNotEmpty == true)
                Text(
                  c.phone!,
                  style: const TextStyle(color: AppColors.inkMuted),
                ),
              if (c.businessName?.isNotEmpty == true) ...[
                const SizedBox(height: 4),
                Text(
                  c.businessName!,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
              if (canWrite && c.status == 'pending') ...[
                const SizedBox(height: 16),
                Row(
                  children: [
                    FilledButton.icon(
                      onPressed: () => _setStatus('approved'),
                      icon: const Icon(Icons.check),
                      label: const Text('Approve'),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      onPressed: () => _setStatus('rejected'),
                      icon: const Icon(Icons.close),
                      label: const Text('Reject'),
                    ),
                  ],
                ),
              ],
              if (c.isWholesale) ...[
                const Divider(height: 32),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Wholesale credit',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    if (canWrite)
                      TextButton(
                        onPressed: _editCreditLimit,
                        child: const Text('Edit limit'),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: _CreditStat(
                        label: 'Owed',
                        value: c.outstandingBalance,
                        color: AppColors.danger,
                      ),
                    ),
                    Expanded(
                      child: _CreditStat(
                        label: 'Limit',
                        value: c.creditLimit,
                        color: AppColors.navy,
                      ),
                    ),
                    Expanded(
                      child: _CreditStat(
                        label: 'Available',
                        value: c.availableCredit,
                        color: AppColors.success,
                      ),
                    ),
                  ],
                ),
                if (canWrite && c.outstandingBalance > 0) ...[
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: _recordPayment,
                    icon: const Icon(Icons.payments_outlined, size: 18),
                    label: const Text('Record a payment'),
                  ),
                ],
                const SizedBox(height: 12),
                Text('Ledger', style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 6),
                Expanded(
                  child: _loadingLedger
                      ? const Center(child: CircularProgressIndicator())
                      : _ledger.isEmpty
                      ? const Text(
                          'No credit activity yet.',
                          style: TextStyle(color: AppColors.inkMuted),
                        )
                      : ListView.builder(
                          itemCount: _ledger.length,
                          itemBuilder: (context, i) =>
                              _LedgerRow(entry: _ledger[i]),
                        ),
                ),
              ] else
                const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}

class _CreditStat extends StatelessWidget {
  final String label;
  final double value;
  final Color color;
  const _CreditStat({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(fontSize: 11, color: AppColors.inkMuted),
      ),
      Text(
        '₵${value.toStringAsFixed(2)}',
        style: TextStyle(fontWeight: FontWeight.w800, color: color),
      ),
    ],
  );
}

class _LedgerRow extends StatelessWidget {
  final CreditLedgerEntry entry;
  const _LedgerRow({required this.entry});

  @override
  Widget build(BuildContext context) {
    final isCharge = entry.amount > 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(
            isCharge ? Icons.arrow_upward : Icons.arrow_downward,
            size: 16,
            color: isCharge ? AppColors.danger : AppColors.success,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.entryType[0].toUpperCase() +
                      entry.entryType.substring(1),
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                if (entry.reason?.isNotEmpty == true)
                  Text(
                    entry.reason!,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.inkMuted,
                    ),
                  ),
              ],
            ),
          ),
          Text(
            '${isCharge ? '+' : '-'}₵${entry.amount.abs().toStringAsFixed(2)}',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: isCharge ? AppColors.danger : AppColors.success,
            ),
          ),
        ],
      ),
    );
  }
}

/// Records a wholesale customer paying down what they owe -- pre-filled
/// with the full outstanding balance, editable down to a partial payment.
class _CreditPaymentDialog extends StatefulWidget {
  final ApiClient api;
  final Customer customer;
  const _CreditPaymentDialog({required this.api, required this.customer});

  @override
  State<_CreditPaymentDialog> createState() => _CreditPaymentDialogState();
}

class _CreditPaymentDialogState extends State<_CreditPaymentDialog> {
  late final _amountController = TextEditingController(
    text: widget.customer.outstandingBalance.toStringAsFixed(2),
  );
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.recordCreditPayment(widget.customer.id, amount: amount);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Record a payment'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: AppColors.danger),
              ),
            ),
          Text(
            'Owed: ₵${widget.customer.outstandingBalance.toStringAsFixed(2)}',
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _amountController,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Amount received (₵)'),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
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
          child: _submitting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Record'),
        ),
      ],
    );
  }
}
