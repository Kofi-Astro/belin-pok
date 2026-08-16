import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';
import '../theme.dart';

const _movementTypes = ['restock', 'adjustment', 'return', 'sale', 'initial'];

/// Shared by the Products and Inventory screens -- logging a stock
/// movement is the same action regardless of where the variant was found.
class StockMovementDialog extends StatefulWidget {
  final ApiClient api;
  final ProductVariant variant;
  const StockMovementDialog({
    super.key,
    required this.api,
    required this.variant,
  });

  @override
  State<StockMovementDialog> createState() => _StockMovementDialogState();
}

class _StockMovementDialogState extends State<StockMovementDialog> {
  final _quantityController = TextEditingController();
  final _reasonController = TextEditingController();
  String _movementType = 'restock';
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    final raw = int.tryParse(_quantityController.text.trim());
    if (raw == null || raw == 0) {
      setState(() => _error = 'Enter a non-zero whole number');
      return;
    }
    // Sales/adjustments-down are entered as a positive "how many left" by
    // the user but must be sent as a negative delta.
    final quantityChange = (_movementType == 'sale') ? -raw.abs() : raw;

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.createStockMovement(
        variantId: widget.variant.id,
        movementType: _movementType,
        quantityChange: quantityChange,
        reason: _reasonController.text.trim(),
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
      title: Text('Adjust stock · ${widget.variant.sku}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Current stock: ${widget.variant.stockQuantity}'),
          const SizedBox(height: 12),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: AppColors.danger),
              ),
            ),
          DropdownButtonFormField<String>(
            initialValue: _movementType,
            decoration: const InputDecoration(labelText: 'Type'),
            items: _movementTypes
                .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                .toList(),
            onChanged: (v) => setState(() => _movementType = v!),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _quantityController,
            decoration: InputDecoration(
              labelText: _movementType == 'sale'
                  ? 'Quantity sold'
                  : 'Quantity (+ to add, - to remove)',
            ),
            keyboardType: const TextInputType.numberWithOptions(signed: true),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _reasonController,
            decoration: const InputDecoration(labelText: 'Reason (optional)'),
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
          child: const Text('Save'),
        ),
      ],
    );
  }
}
