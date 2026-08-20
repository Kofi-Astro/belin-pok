import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../auth_controller.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

/// The only place categories get created/renamed/reordered/removed --
/// every product's category picker (and Log Sale's "quick log by type")
/// pulls straight from this table, so an empty table means those dropdowns
/// have nothing to show.
class CategoriesScreen extends StatefulWidget {
  const CategoriesScreen({super.key});

  @override
  State<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<CategoriesScreen> {
  final _api = ApiClient();
  List<Category> _categories = [];
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
      final categories = await _api.listCategories();
      if (mounted) setState(() => _categories = categories);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openForm({Category? category}) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => _CategoryFormDialog(api: _api, category: category),
    );
    if (changed == true) _load();
  }

  Future<void> _delete(Category category) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Delete "${category.name}"?'),
        content: const Text(
          "This can't be undone. If any products still use this category, "
          "deleting is blocked automatically -- move them to a different "
          'category first.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await _api.deleteCategory(category.id);
      _load();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canWrite =
        context.watch<AuthController>().profile?.canManageInventory ?? false;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Categories'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      floatingActionButton: canWrite
          ? FloatingActionButton.extended(
              onPressed: () => _openForm(),
              icon: const Icon(Icons.add),
              label: const Text('Add Category'),
            )
          : null,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text('Error: $_error'))
          : _categories.isEmpty
          ? EmptyState(
              icon: Icons.category_outlined,
              title: 'No categories yet',
              message: canWrite
                  ? 'Tap "Add Category" below to create one -- products '
                        "can't be added until at least one exists."
                  : 'Ask an owner or inventory manager to add one.',
            )
          : ListView.builder(
              padding: const EdgeInsets.all(20),
              itemCount: _categories.length,
              itemBuilder: (context, index) {
                final category = _categories[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: AppColors.navy,
                      child: Text(
                        '${category.displayOrder}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    title: Text(
                      category.name,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(
                      category.description?.isNotEmpty == true
                          ? category.description!
                          : category.slug,
                      style: const TextStyle(color: AppColors.inkMuted),
                    ),
                    trailing: canWrite
                        ? IconButton(
                            icon: const Icon(
                              Icons.delete_outline,
                              color: AppColors.danger,
                            ),
                            onPressed: () => _delete(category),
                          )
                        : null,
                    onTap: canWrite
                        ? () => _openForm(category: category)
                        : null,
                  ),
                );
              },
            ),
    );
  }
}

class _CategoryFormDialog extends StatefulWidget {
  final ApiClient api;
  final Category? category;
  const _CategoryFormDialog({required this.api, this.category});

  @override
  State<_CategoryFormDialog> createState() => _CategoryFormDialogState();
}

class _CategoryFormDialogState extends State<_CategoryFormDialog> {
  late final _nameController = TextEditingController(
    text: widget.category?.name ?? '',
  );
  late final _descriptionController = TextEditingController(
    text: widget.category?.description ?? '',
  );
  late final _displayOrderController = TextEditingController(
    text: '${widget.category?.displayOrder ?? 0}',
  );
  bool _submitting = false;
  String? _error;

  bool get _isEditing => widget.category != null;

  String _slugify(String input) => input
      .toLowerCase()
      .trim()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Name is required');
      return;
    }
    final slug = _slugify(name);
    if (slug.isEmpty) {
      setState(() => _error = 'That name needs at least one letter or number');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final displayOrder = int.tryParse(_displayOrderController.text.trim()) ?? 0;
      if (_isEditing) {
        await widget.api.updateCategory(widget.category!.id, {
          'name': name,
          'slug': slug,
          'description': _descriptionController.text.trim(),
          'display_order': displayOrder,
        });
      } else {
        await widget.api.createCategory(
          name: name,
          slug: slug,
          description: _descriptionController.text.trim(),
          displayOrder: displayOrder,
        );
      }
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
    _descriptionController.dispose();
    _displayOrderController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_isEditing ? 'Edit category' : 'Add category'),
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
            TextField(
              controller: _nameController,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: 'Description (optional)',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _displayOrderController,
              decoration: const InputDecoration(
                labelText: 'Display order',
                helperText: 'Lower numbers show first in the list.',
              ),
              keyboardType: TextInputType.number,
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
              : Text(_isEditing ? 'Save' : 'Add'),
        ),
      ],
    );
  }
}
