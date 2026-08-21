import 'package:flutter/material.dart';

import '../api_client.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

const _paymentMethods = ['cash', 'mobile_money', 'card', 'credit'];

String _paymentLabel(String method) => switch (method) {
  'cash' => 'Cash',
  'mobile_money' => 'Mobile Money',
  'card' => 'Card',
  'credit' => 'On Account (Credit)',
  _ => method,
};

/// Retail Mode prices every cart line at the item's normal retail price.
/// Wholesale Mode prices new lines at wholesale/pack rates instead and
/// opens the customer picker -- see the banner at the top of the screen.
enum SaleMode { retail, wholesale }

/// A cart line is either picked from the product grid (product/variant
/// set, exact price looked up server-side at checkout) or "quick logged"
/// by product type (category set instead, price entered by hand) --
/// see _QuickLogForm. Exactly one of the two is set.
class _CartLine {
  final Product? product;
  final ProductVariant? variant;
  final Category? category;
  final String? note;
  int quantity;
  String priceTier;
  double? _quickPrice;

  _CartLine.picked({
    required Product this.product,
    required ProductVariant this.variant,
    required this.quantity,
    this.priceTier = 'retail',
  }) : category = null,
       note = null;

  _CartLine.quickLog({
    required Category this.category,
    required this.quantity,
    required double unitPrice,
    this.note,
    this.priceTier = 'retail',
  }) : product = null,
       variant = null,
       _quickPrice = unitPrice;

  bool get isQuickLog => variant == null;

  /// Price per selection unit: per piece for retail/wholesale, per pack
  /// for 'pack' (quantity itself then counts packs, not pieces -- see
  /// _VariantPickForm and the payload built in _CheckoutDialogState).
  double get unitPrice {
    if (isQuickLog) return _quickPrice ?? 0;
    final v = variant!;
    final p = product!;
    return switch (priceTier) {
      'wholesale' => v.wholesalePrice ?? (v.priceOverride ?? p.basePrice),
      'pack' => (v.packPrice ?? 0) / (v.packSize ?? 1),
      _ => v.priceOverride ?? p.basePrice,
    };
  }

  int get maxQuantity {
    if (isQuickLog) return 999;
    final v = variant!;
    return priceTier == 'pack'
        ? v.stockQuantity ~/ (v.packSize ?? 1)
        : v.stockQuantity;
  }

  double get lineTotal => unitPrice * quantity;

  String get label {
    if (isQuickLog) return category!.name;
    final v = variant!;
    final p = product!;
    return '${p.name} (${v.size}${v.color != null ? ' · ${v.color}' : ''})'
        '${priceTier == 'pack'
            ? ' · pack of ${v.packSize}'
            : priceTier == 'wholesale'
            ? ' · wholesale'
            : ''}';
  }
}

/// A real register: build up a cart from several products (tap a photo,
/// pick the size/color, set a quantity), then check out once with one or
/// more payment methods covering the total. Deducts stock and records the
/// payment together as one transaction, so "today's sales" is a list of
/// actual receipts rather than disconnected stock-quantity edits.
class LogSaleScreen extends StatefulWidget {
  const LogSaleScreen({super.key});

  @override
  State<LogSaleScreen> createState() => _LogSaleScreenState();
}

class _LogSaleScreenState extends State<LogSaleScreen> {
  final _api = ApiClient();
  final _searchController = TextEditingController();

  List<Product> _quickPick = [];
  List<Product> _results = [];
  Product? _picking;
  ProductVariant? _pickVariant;
  String _pickTier = 'retail';
  int _pickQuantity = 1;
  bool _searching = false;
  bool _loadingProduct = false;
  String? _error;

  final List<_CartLine> _cart = [];

  List<PosSale> _todaySales = [];
  bool _loadingSales = true;

  SaleMode _mode = SaleMode.retail;
  List<Customer> _wholesaleCustomers = [];
  Customer? _selectedCustomer;

  // "Pick from products" (the image/size/color grid, unchanged) vs "Log
  // by type" (category + price by hand -- see _QuickLogForm) are two
  // different ways to add a cart line; which one is showing right now.
  bool _quickLogMode = false;
  List<Category> _categories = [];

  @override
  void initState() {
    super.initState();
    _loadQuickPick();
    _loadTodaySales();
    _loadCategories();
  }

  Future<void> _loadCategories() async {
    try {
      final categories = await _api.listCategories();
      if (mounted) setState(() => _categories = categories);
    } on ApiException {
      // Non-critical -- Log by Type just won't have options until retry.
    }
  }

  Future<void> _loadWholesaleCustomers() async {
    try {
      final customers = await _api.listCustomers(customerType: 'wholesale');
      if (mounted) setState(() => _wholesaleCustomers = customers);
    } on ApiException {
      // Non-critical -- staff can retry by reopening the picker.
    }
  }

  void _setMode(SaleMode mode) {
    setState(() {
      _mode = mode;
      if (mode == SaleMode.retail) {
        _selectedCustomer = null;
      } else if (_wholesaleCustomers.isEmpty) {
        _loadWholesaleCustomers();
      }
    });
  }

  Future<void> _pickCustomer() async {
    if (_wholesaleCustomers.isEmpty) await _loadWholesaleCustomers();
    if (!mounted) return;
    final picked = await showDialog<Customer>(
      context: context,
      builder: (_) => _CustomerPickerDialog(customers: _wholesaleCustomers),
    );
    if (picked != null) setState(() => _selectedCustomer = picked);
  }

  Future<void> _loadQuickPick() async {
    try {
      final products = await _api.listProducts(status: 'active');
      if (mounted) setState(() => _quickPick = products);
    } on ApiException {
      // Convenience only -- search still works if this fails.
    }
  }

  Future<void> _loadTodaySales() async {
    setState(() => _loadingSales = true);
    try {
      final sales = await _api.listPosSales(limit: 200);
      final now = DateTime.now();
      final today = sales.where((s) {
        final d = s.createdAt.toLocal();
        return d.year == now.year && d.month == now.month && d.day == now.day;
      }).toList();
      if (mounted) setState(() => _todaySales = today);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loadingSales = false);
    }
  }

  Future<void> _search(String query) async {
    if (query.trim().isEmpty) {
      setState(() => _results = []);
      return;
    }
    setState(() => _searching = true);
    try {
      final results = await _api.listProducts(
        search: query.trim(),
        status: 'active',
      );
      if (mounted) setState(() => _results = results);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _selectProduct(Product product) async {
    setState(() {
      _loadingProduct = true;
      _error = null;
    });
    try {
      final full = await _api.getProduct(product.id);
      if (mounted) {
        setState(() {
          _picking = full;
          _pickVariant = null;
          _pickQuantity = 1;
          _pickTier = _mode == SaleMode.wholesale ? 'wholesale' : 'retail';
        });
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loadingProduct = false);
    }
  }

  void _cancelPicking() {
    setState(() {
      _picking = null;
      _pickVariant = null;
      _pickQuantity = 1;
      _pickTier = _mode == SaleMode.wholesale ? 'wholesale' : 'retail';
      _results = [];
      _searchController.clear();
    });
  }

  void _addToCart() {
    final product = _picking;
    final variant = _pickVariant;
    if (product == null || variant == null) return;

    setState(() {
      final existing = _cart
          .where((l) => l.variant?.id == variant.id && l.priceTier == _pickTier)
          .firstOrNull;
      if (existing != null) {
        existing.quantity = (existing.quantity + _pickQuantity).clamp(
          1,
          existing.maxQuantity,
        );
      } else {
        _cart.add(
          _CartLine.picked(
            product: product,
            variant: variant,
            quantity: _pickQuantity,
            priceTier: _pickTier,
          ),
        );
      }
    });
    _cancelPicking();
  }

  void _addQuickLogToCart(
    Category category,
    double unitPrice,
    int quantity,
    String? note,
  ) {
    setState(() {
      _cart.add(
        _CartLine.quickLog(
          category: category,
          quantity: quantity,
          unitPrice: unitPrice,
          note: note,
          priceTier: _mode == SaleMode.wholesale ? 'wholesale' : 'retail',
        ),
      );
    });
  }

  double get _cartTotal => _cart.fold(0, (sum, l) => sum + l.lineTotal);

  Future<void> _openCheckout() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (_) => _CheckoutDialog(
        api: _api,
        cart: _cart,
        total: _cartTotal,
        customer: _selectedCustomer,
      ),
    );
    if (result == true) {
      setState(() {
        _cart.clear();
        _selectedCustomer = null;
        _mode = SaleMode.retail;
      });
      _loadTodaySales();
    }
  }

  Future<void> _voidSale(PosSale sale) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Void this sale?'),
        content: Text(
          'This puts every item back in stock and removes '
          '₵${sale.total.toStringAsFixed(2)} from today\'s total. For '
          "fixing a mistake, not a customer return.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Void sale'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await _api.voidPosSale(sale.id);
      _loadTodaySales();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final activeSales = _todaySales.where((s) => !s.isVoided).toList();
    final todayTotal = activeSales.fold<double>(0, (sum, s) => sum + s.total);
    final todayItemCount = activeSales.fold<int>(
      0,
      (sum, s) => sum + s.items.fold<int>(0, (n, i) => n + i.quantity),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Log a Sale')),
      floatingActionButton: _cart.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: _openCheckout,
              icon: const Icon(Icons.point_of_sale),
              label: Text('Checkout · ₵${_cartTotal.toStringAsFixed(2)}'),
            ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 100),
        children: [
          _ModeBanner(
            mode: _mode,
            customer: _selectedCustomer,
            onModeChanged: _setMode,
            onPickCustomer: _pickCustomer,
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

          if (_cart.isNotEmpty) ...[
            Text(
              'Cart',
              style: Theme.of(
                context,
              ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            for (final line in _cart)
              _CartTile(
                line: line,
                onRemove: () => setState(() => _cart.remove(line)),
                onQuantityChanged: (q) => setState(() => line.quantity = q),
              ),
            const SizedBox(height: 20),
          ],

          if (_picking == null) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(
                    value: false,
                    label: Text('Pick from Products'),
                    icon: Icon(Icons.checkroom),
                  ),
                  ButtonSegment(
                    value: true,
                    label: Text('Log by Type'),
                    icon: Icon(Icons.edit_note),
                  ),
                ],
                selected: {_quickLogMode},
                onSelectionChanged: (s) =>
                    setState(() => _quickLogMode = s.first),
              ),
            ),
          ],

          if (_quickLogMode && _picking == null)
            _QuickLogForm(categories: _categories, onAdd: _addQuickLogToCart)
          else if (_picking == null) ...[
            if (_quickPick.isNotEmpty) ...[
              Text(
                'Quick pick',
                style: Theme.of(
                  context,
                ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 128,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _quickPick.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 10),
                  itemBuilder: (context, index) => _QuickPickCard(
                    product: _quickPick[index],
                    onTap: () => _selectProduct(_quickPick[index]),
                  ),
                ),
              ),
              const SizedBox(height: 20),
            ],
            TextField(
              controller: _searchController,
              decoration: InputDecoration(
                labelText: 'Or search by name',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searching
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : null,
              ),
              onChanged: _search,
            ),
            const SizedBox(height: 12),
            if (_loadingProduct)
              const Center(child: CircularProgressIndicator()),
            for (final product in _results)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: _Thumb(product: product),
                  title: Text(product.name),
                  subtitle: Text('₵${product.basePrice.toStringAsFixed(2)}'),
                  onTap: () => _selectProduct(product),
                ),
              ),
          ] else
            _VariantPickForm(
              product: _picking!,
              variant: _pickVariant,
              quantity: _pickQuantity,
              mode: _mode,
              priceTier: _pickTier,
              onVariantChanged: (v) => setState(() {
                _pickVariant = v;
                _pickQuantity = 1;
                _pickTier = _mode == SaleMode.wholesale
                    ? 'wholesale'
                    : 'retail';
              }),
              onTierChanged: (t) => setState(() {
                _pickTier = t;
                _pickQuantity = 1;
              }),
              onQuantityChanged: (q) => setState(() => _pickQuantity = q),
              onCancel: _cancelPicking,
              onAddToCart: _addToCart,
            ),

          const SizedBox(height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Today's Sales",
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              Text(
                '$todayItemCount item(s) · ₵${todayTotal.toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_loadingSales)
            const Center(child: CircularProgressIndicator())
          else if (_todaySales.isEmpty)
            const EmptyState(
              icon: Icons.point_of_sale_outlined,
              title: 'No sales logged today yet',
              message: 'Whatever you check out above will show up here.',
            )
          else
            for (final sale in _todaySales)
              _SaleCard(
                api: _api,
                sale: sale,
                onVoid: () => _voidSale(sale),
                onChanged: _loadTodaySales,
              ),
        ],
      ),
    );
  }
}

/// A product's cover photo (or a placeholder icon), used by both
/// _QuickPickCard and the variant-pick flow.
class _Thumb extends StatelessWidget {
  final Product product;
  const _Thumb({required this.product});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        width: 44,
        height: 44,
        child: product.primaryImage == null
            ? Container(
                color: const Color(0xFFEFEBE3),
                child: const Icon(
                  Icons.checkroom_outlined,
                  color: AppColors.inkMuted,
                ),
              )
            : Image.network(
                product.primaryImage!.publicUrl(AppConfig.supabaseUrl),
                fit: BoxFit.cover,
                errorBuilder: (context, error, stack) =>
                    const Icon(Icons.broken_image_outlined),
              ),
      ),
    );
  }
}

/// One tile in the product grid -- tapping it opens _VariantPickForm to
/// choose a size/color and quantity before adding to the cart.
class _QuickPickCard extends StatelessWidget {
  final Product product;
  final VoidCallback onTap;
  const _QuickPickCard({required this.product, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 96,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.navy.withValues(alpha: 0.12)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 80,
                height: 60,
                child: product.primaryImage == null
                    ? Container(
                        color: const Color(0xFFEFEBE3),
                        child: const Icon(
                          Icons.checkroom_outlined,
                          color: AppColors.inkMuted,
                        ),
                      )
                    : Image.network(
                        product.primaryImage!.publicUrl(AppConfig.supabaseUrl),
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stack) =>
                            const Icon(Icons.broken_image_outlined),
                      ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              product.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
            ),
            Text(
              '₵${product.basePrice.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 11, color: AppColors.inkMuted),
            ),
          ],
        ),
      ),
    );
  }
}

/// One line in the running cart sidebar, with a quantity stepper and a
/// remove button.
class _CartTile extends StatelessWidget {
  final _CartLine line;
  final VoidCallback onRemove;
  final ValueChanged<int> onQuantityChanged;

  const _CartTile({
    required this.line,
    required this.onRemove,
    required this.onQuantityChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text(
          line.label,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '₵${line.unitPrice.toStringAsFixed(2)} ${line.priceTier == 'pack' ? 'per pack' : 'each'}',
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.remove_circle_outline, size: 20),
              onPressed: line.quantity > 1
                  ? () => onQuantityChanged(line.quantity - 1)
                  : null,
            ),
            Text(
              '${line.quantity}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            IconButton(
              icon: const Icon(Icons.add_circle_outline, size: 20),
              onPressed: line.quantity < line.maxQuantity
                  ? () => onQuantityChanged(line.quantity + 1)
                  : null,
            ),
            const SizedBox(width: 8),
            Text(
              '₵${line.lineTotal.toStringAsFixed(2)}',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            IconButton(
              icon: const Icon(
                Icons.delete_outline,
                size: 20,
                color: AppColors.danger,
              ),
              onPressed: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}

/// The global toggle described in the spec: switching to Wholesale Mode
/// shifts new cart lines to wholesale/pack pricing and prompts for a
/// verified customer. Retail Mode always prices at the normal retail
/// price and clears whichever customer was selected.
class _ModeBanner extends StatelessWidget {
  final SaleMode mode;
  final Customer? customer;
  final ValueChanged<SaleMode> onModeChanged;
  final VoidCallback onPickCustomer;

  const _ModeBanner({
    required this.mode,
    required this.customer,
    required this.onModeChanged,
    required this.onPickCustomer,
  });

  @override
  Widget build(BuildContext context) {
    final isWholesale = mode == SaleMode.wholesale;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isWholesale
            ? AppColors.amber.withValues(alpha: 0.12)
            : AppColors.navy.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isWholesale
              ? AppColors.amber
              : AppColors.navy.withValues(alpha: 0.15),
        ),
      ),
      child: Wrap(
        spacing: 12,
        runSpacing: 10,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SegmentedButton<SaleMode>(
            segments: const [
              ButtonSegment(
                value: SaleMode.retail,
                label: Text('Retail Mode'),
                icon: Icon(Icons.storefront),
              ),
              ButtonSegment(
                value: SaleMode.wholesale,
                label: Text('Wholesale Mode'),
                icon: Icon(Icons.inventory),
              ),
            ],
            selected: {mode},
            onSelectionChanged: (s) => onModeChanged(s.first),
          ),
          if (isWholesale)
            ActionChip(
              avatar: Icon(
                customer == null ? Icons.person_search : Icons.person,
                size: 18,
              ),
              label: Text(customer?.fullName ?? 'Select wholesale customer'),
              onPressed: onPickCustomer,
            ),
          if (isWholesale && customer != null && !customer!.isWholesaleVerified)
            const Chip(
              avatar: Icon(
                Icons.warning_amber,
                size: 18,
                color: AppColors.warning,
              ),
              label: Text('Not yet approved -- credit sales blocked'),
              backgroundColor: Color(0x1AFFA000),
            ),
        ],
      ),
    );
  }
}

/// Search-and-pick a wholesale customer -- opened from _ModeBanner when
/// switching into Wholesale Mode with no customer already selected.
class _CustomerPickerDialog extends StatefulWidget {
  final List<Customer> customers;
  const _CustomerPickerDialog({required this.customers});

  @override
  State<_CustomerPickerDialog> createState() => _CustomerPickerDialogState();
}

class _CustomerPickerDialogState extends State<_CustomerPickerDialog> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.customers
        .where(
          (c) =>
              c.fullName.toLowerCase().contains(_query.toLowerCase()) ||
              (c.businessName?.toLowerCase().contains(_query.toLowerCase()) ??
                  false),
        )
        .toList();
    return AlertDialog(
      title: const Text('Select wholesale customer'),
      content: SizedBox(
        width: 380,
        height: 420,
        child: Column(
          children: [
            TextField(
              autofocus: true,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                labelText: 'Search by name or business',
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: filtered.isEmpty
                  ? const Center(
                      child: Text(
                        'No wholesale customers found.',
                        style: TextStyle(color: AppColors.inkMuted),
                      ),
                    )
                  : ListView.builder(
                      itemCount: filtered.length,
                      itemBuilder: (context, i) {
                        final c = filtered[i];
                        return ListTile(
                          title: Text(
                            c.businessName?.isNotEmpty == true
                                ? c.businessName!
                                : c.fullName,
                          ),
                          subtitle: Text(
                            c.isWholesaleVerified
                                ? 'Approved · ₵${c.availableCredit.toStringAsFixed(2)} credit available'
                                : 'Not yet approved',
                          ),
                          onTap: () => Navigator.of(context).pop(c),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}

/// Log a sale by product type instead of hunting down the exact SKU --
/// for a staff member entering a wholesale sale by hand who knows "3 caps
/// at ₵15, 2 sweaters at ₵40" but doesn't have time to look up which cap,
/// which sweater. Only category + price are required; a note is optional
/// context for whoever later attaches the exact product (see the
/// "Identify" action on today's sales below) -- which itself is optional,
/// entirely at the owner's pace.
class _QuickLogForm extends StatefulWidget {
  final List<Category> categories;
  final void Function(
    Category category,
    double unitPrice,
    int quantity,
    String? note,
  )
  onAdd;

  const _QuickLogForm({required this.categories, required this.onAdd});

  @override
  State<_QuickLogForm> createState() => _QuickLogFormState();
}

class _QuickLogFormState extends State<_QuickLogForm> {
  Category? _category;
  final _priceController = TextEditingController();
  final _noteController = TextEditingController();
  int _quantity = 1;
  String? _error;

  void _submit() {
    final category = _category;
    final price = double.tryParse(_priceController.text.trim());
    if (category == null) {
      setState(() => _error = 'Pick a product type');
      return;
    }
    if (price == null || price <= 0) {
      setState(() => _error = 'Enter a price');
      return;
    }
    widget.onAdd(category, price, _quantity, _noteController.text.trim());
    setState(() {
      _category = null;
      _quantity = 1;
      _error = null;
      _priceController.clear();
      _noteController.clear();
    });
  }

  @override
  void dispose() {
    _priceController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'For when there\'s no time to find the exact item -- record what type '
              'and what it sold for now, and attach the exact product later if you want to.',
              style: TextStyle(color: AppColors.inkMuted, fontSize: 12),
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
            DropdownButtonFormField<Category>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'Product type'),
              items: widget.categories
                  .map((c) => DropdownMenuItem(value: c, child: Text(c.name)))
                  .toList(),
              onChanged: (c) => setState(() => _category = c),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _priceController,
              decoration: const InputDecoration(labelText: 'Price sold at (₵)'),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Text('Quantity', style: Theme.of(context).textTheme.titleSmall),
                const Spacer(),
                IconButton.filledTonal(
                  icon: const Icon(Icons.remove),
                  onPressed: _quantity > 1
                      ? () => setState(() => _quantity--)
                      : null,
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    '$_quantity',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton.filledTonal(
                  icon: const Icon(Icons.add),
                  onPressed: () => setState(() => _quantity++),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _noteController,
              decoration: const InputDecoration(
                labelText: 'Note (optional)',
                hintText:
                    'e.g. blue, medium -- helps whoever identifies it later',
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _submit,
              icon: const Icon(Icons.add_shopping_cart),
              label: const Text('Add to Cart'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Size/color/quantity picker shown after tapping a product, priced live
/// for whichever SaleMode (retail/wholesale) is currently active before
/// the line gets added to the cart.
class _VariantPickForm extends StatelessWidget {
  final Product product;
  final ProductVariant? variant;
  final int quantity;
  final SaleMode mode;
  final String priceTier;
  final ValueChanged<ProductVariant> onVariantChanged;
  final ValueChanged<String> onTierChanged;
  final ValueChanged<int> onQuantityChanged;
  final VoidCallback onCancel;
  final VoidCallback onAddToCart;

  const _VariantPickForm({
    required this.product,
    required this.variant,
    required this.quantity,
    required this.mode,
    required this.priceTier,
    required this.onVariantChanged,
    required this.onTierChanged,
    required this.onQuantityChanged,
    required this.onCancel,
    required this.onAddToCart,
  });

  double _unitPriceFor(String tier) => switch (tier) {
    'wholesale' =>
      variant?.wholesalePrice ?? (variant?.priceOverride ?? product.basePrice),
    'pack' => (variant?.packPrice ?? 0) / (variant?.packSize ?? 1),
    _ => variant?.priceOverride ?? product.basePrice,
  };

  int get _maxQuantity {
    final v = variant;
    if (v == null) return 0;
    return priceTier == 'pack'
        ? v.stockQuantity ~/ (v.packSize ?? 1)
        : v.stockQuantity;
  }

  @override
  Widget build(BuildContext context) {
    final unitPrice = _unitPriceFor(priceTier);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    product.name,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: 'Search for a different item',
                  onPressed: onCancel,
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text('Size / color', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            if (product.variants.isEmpty)
              const Text(
                'This product has no sizes/colors set up yet.',
                style: TextStyle(color: AppColors.inkMuted),
              ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final v in product.variants)
                  ChoiceChip(
                    label: Text(
                      '${v.size}${v.color != null ? ' · ${v.color}' : ''}'
                      '${v.stockQuantity <= 0 ? ' (out of stock)' : ''}',
                    ),
                    selected: variant?.id == v.id,
                    onSelected: v.stockQuantity <= 0
                        ? null
                        : (_) => onVariantChanged(v),
                  ),
              ],
            ),
            if (variant != null && mode == SaleMode.wholesale) ...[
              const SizedBox(height: 16),
              Text('Price', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: Text(
                      'Wholesale · ₵${_unitPriceFor('wholesale').toStringAsFixed(2)}',
                    ),
                    selected: priceTier == 'wholesale',
                    onSelected: (_) => onTierChanged('wholesale'),
                  ),
                  if (variant!.hasPackPricing)
                    ChoiceChip(
                      label: Text(
                        'Pack of ${variant!.packSize} · ₵${variant!.packPrice!.toStringAsFixed(2)}',
                      ),
                      selected: priceTier == 'pack',
                      onSelected: (_) => onTierChanged('pack'),
                    ),
                  ChoiceChip(
                    label: const Text('Retail'),
                    selected: priceTier == 'retail',
                    onSelected: (_) => onTierChanged('retail'),
                  ),
                ],
              ),
            ],
            if (variant != null) ...[
              const SizedBox(height: 20),
              Text(
                priceTier == 'pack' ? 'Packs' : 'Quantity',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  IconButton.filledTonal(
                    icon: const Icon(Icons.remove),
                    onPressed: quantity > 1
                        ? () => onQuantityChanged(quantity - 1)
                        : null,
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Text(
                      '$quantity',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton.filledTonal(
                    icon: const Icon(Icons.add),
                    onPressed: quantity < _maxQuantity
                        ? () => onQuantityChanged(quantity + 1)
                        : null,
                  ),
                  const Spacer(),
                  Text(
                    '₵${(unitPrice * quantity).toStringAsFixed(2)}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 18,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: onAddToCart,
                icon: const Icon(Icons.add_shopping_cart),
                label: const Text('Add to Cart'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// One completed sale in the "Today's Sales" list -- expands to show its
/// line items and payments, with a void action and, for any quick-logged
/// line, an "Identify" action that opens _IdentifyProductDialog.
class _SaleCard extends StatelessWidget {
  final ApiClient api;
  final PosSale sale;
  final VoidCallback onVoid;
  final VoidCallback onChanged;

  const _SaleCard({
    required this.api,
    required this.sale,
    required this.onVoid,
    required this.onChanged,
  });

  Future<void> _identify(BuildContext context, PosSaleItem item) async {
    final variant = await showDialog<ProductVariant>(
      context: context,
      builder: (_) => _IdentifyProductDialog(api: api),
    );
    if (variant == null) return;
    try {
      await api.identifyPosSaleItem(sale.id, item.id, variantId: variant.id);
      onChanged();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final time = sale.createdAt.toLocal();
    final timeLabel =
        '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
    final paymentSummary = sale.payments
        .map((p) => _paymentLabel(p.method))
        .toSet()
        .join(' + ');
    final unidentifiedCount = sale.items.where((i) => !i.isIdentified).length;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: sale.isVoided ? AppColors.inkMuted.withValues(alpha: 0.06) : null,
      child: ExpansionTile(
        title: Text(
          '${sale.items.fold<int>(0, (n, i) => n + i.quantity)} item(s) · '
          '₵${sale.total.toStringAsFixed(2)} · $paymentSummary',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            decoration: sale.isVoided ? TextDecoration.lineThrough : null,
            color: sale.isVoided ? AppColors.inkMuted : null,
          ),
        ),
        subtitle: Text(
          [
            if (sale.staffName != null) sale.staffName!,
            if (sale.customerName != null) sale.customerName!,
            timeLabel,
            if (sale.isVoided) 'Voided',
            if (!sale.isVoided && unidentifiedCount > 0)
              '$unidentifiedCount need product details',
          ].join(' · '),
          style: unidentifiedCount > 0 && !sale.isVoided
              ? const TextStyle(
                  color: AppColors.warning,
                  fontWeight: FontWeight.w600,
                )
              : null,
        ),
        trailing: sale.isVoided
            ? const Icon(Icons.undo, color: AppColors.inkMuted)
            : IconButton(
                icon: const Icon(Icons.undo, size: 18),
                tooltip: 'Void this sale',
                onPressed: onVoid,
              ),
        children: [
          for (final item in sale.items)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${item.quantity} × ${item.label}'),
                        if (item.note?.isNotEmpty == true)
                          Text(
                            item.note!,
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.inkMuted,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Text('₵${item.lineTotal.toStringAsFixed(2)}'),
                  if (!item.isIdentified && !sale.isVoided)
                    TextButton(
                      onPressed: () => _identify(context, item),
                      child: const Text('Identify'),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

/// A slimmer product/variant picker for attaching an exact SKU to a
/// quick-logged sale after the fact -- same search-then-pick shape as
/// the main Log Sale flow, without the cart/checkout machinery.
class _IdentifyProductDialog extends StatefulWidget {
  final ApiClient api;
  const _IdentifyProductDialog({required this.api});

  @override
  State<_IdentifyProductDialog> createState() => _IdentifyProductDialogState();
}

class _IdentifyProductDialogState extends State<_IdentifyProductDialog> {
  List<Product> _results = [];
  Product? _picking;
  bool _searching = false;

  Future<void> _search(String query) async {
    if (query.trim().isEmpty) {
      setState(() => _results = []);
      return;
    }
    setState(() => _searching = true);
    try {
      final results = await widget.api.listProducts(search: query.trim());
      if (mounted) setState(() => _results = results);
    } on ApiException {
      // Leave results as-is -- staff can retry the search.
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _selectProduct(Product product) async {
    final full = await widget.api.getProduct(product.id);
    if (mounted) setState(() => _picking = full);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Identify product'),
      content: SizedBox(
        width: 380,
        height: 420,
        child: _picking == null
            ? Column(
                children: [
                  TextField(
                    autofocus: true,
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      labelText: 'Search by name',
                      suffixIcon: _searching
                          ? const Padding(
                              padding: EdgeInsets.all(12),
                              child: SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              ),
                            )
                          : null,
                    ),
                    onChanged: _search,
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: ListView.builder(
                      itemCount: _results.length,
                      itemBuilder: (context, i) => ListTile(
                        title: Text(_results[i].name),
                        subtitle: Text(
                          '₵${_results[i].basePrice.toStringAsFixed(2)}',
                        ),
                        onTap: () => _selectProduct(_results[i]),
                      ),
                    ),
                  ),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          _picking!.name,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => setState(() => _picking = null),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final v in _picking!.variants)
                        ActionChip(
                          label: Text(
                            '${v.size}${v.color != null ? ' · ${v.color}' : ''} (${v.stockQuantity})',
                          ),
                          onPressed: () => Navigator.of(context).pop(v),
                        ),
                    ],
                  ),
                ],
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}

/// Collects one or more payments (see _Payment) covering the cart total
/// -- a wholesale sale can include a 'credit' payment charged to the
/// selected customer's account, everything else is collected on the
/// spot. Submits the whole cart as one POST /pos-sales transaction.
class _CheckoutDialog extends StatefulWidget {
  final ApiClient api;
  final List<_CartLine> cart;
  final double total;
  final Customer? customer;

  const _CheckoutDialog({
    required this.api,
    required this.cart,
    required this.total,
    required this.customer,
  });

  @override
  State<_CheckoutDialog> createState() => _CheckoutDialogState();
}

/// One payment line within _CheckoutDialog -- a sale can split its total
/// across several of these (e.g. part cash, part credit).
class _Payment {
  String method;
  final TextEditingController controller;
  _Payment(this.method, double amount)
    : controller = TextEditingController(text: amount.toStringAsFixed(2));
}

class _CheckoutDialogState extends State<_CheckoutDialog> {
  late final List<_Payment> _payments = [_Payment('cash', widget.total)];
  bool _submitting = false;
  String? _error;

  /// Credit is only offered as a tender when a wholesale-verified customer
  /// is attached to the sale -- the backend enforces this too (a DB
  /// trigger blocks it outright), but hiding the option here is what
  /// keeps the checkout UI from ever suggesting it's possible otherwise.
  bool get _creditAvailable => widget.customer?.isWholesaleVerified ?? false;

  double get _paid => _payments.fold(
    0,
    (sum, p) => sum + (double.tryParse(p.controller.text) ?? 0),
  );

  double get _remaining => widget.total - _paid;

  double get _creditRequested => _payments
      .where((p) => p.method == 'credit')
      .fold(0.0, (sum, p) => sum + (double.tryParse(p.controller.text) ?? 0));

  bool get _exceedsCreditLimit =>
      widget.customer != null &&
      _creditRequested > widget.customer!.availableCredit;

  bool get _canSubmit =>
      !_submitting && _remaining.abs() < 0.01 && !_exceedsCreditLimit;

  void _addPaymentLine() {
    setState(
      () => _payments.add(_Payment('cash', _remaining.clamp(0, widget.total))),
    );
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.api.createPosSale(
        customerId: widget.customer?.id,
        items: [
          for (final line in widget.cart)
            if (line.isQuickLog)
              {
                'category_id': line.category!.id,
                if (line.note != null && line.note!.isNotEmpty)
                  'note': line.note,
                'price_tier': line.priceTier,
                'quantity': line.quantity,
                'unit_price': line.unitPrice,
              }
            else
              {
                'variant_id': line.variant!.id,
                'price_tier': line.priceTier,
                'quantity': line.quantity,
              },
        ],
        payments: [
          for (final p in _payments)
            {
              'method': p.method,
              'amount': double.tryParse(p.controller.text) ?? 0,
            },
        ],
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
    for (final p in _payments) {
      p.controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Checkout'),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Total: ₵${widget.total.toStringAsFixed(2)}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
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
            if (widget.customer != null) ...[
              Text(
                _creditAvailable
                    ? 'Customer: ${widget.customer!.fullName} · ₵${widget.customer!.availableCredit.toStringAsFixed(2)} credit available'
                    : '${widget.customer!.fullName} is not an approved wholesale account -- credit unavailable',
                style: TextStyle(
                  fontSize: 12,
                  color: _creditAvailable
                      ? AppColors.inkMuted
                      : AppColors.warning,
                ),
              ),
              const SizedBox(height: 8),
            ],
            for (final p in _payments)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: p.method,
                        decoration: const InputDecoration(labelText: 'Method'),
                        items: _paymentMethods
                            .where((m) => m != 'credit' || _creditAvailable)
                            .map(
                              (m) => DropdownMenuItem(
                                value: m,
                                child: Text(_paymentLabel(m)),
                              ),
                            )
                            .toList(),
                        onChanged: (v) => setState(() => p.method = v!),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: p.controller,
                        decoration: const InputDecoration(
                          labelText: 'Amount (₵)',
                        ),
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                    if (_payments.length > 1)
                      IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () => setState(() => _payments.remove(p)),
                      ),
                  ],
                ),
              ),
            TextButton.icon(
              onPressed: _addPaymentLine,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Split into another payment method'),
            ),
            const SizedBox(height: 8),
            Text(
              _remaining.abs() < 0.01
                  ? 'Fully covered'
                  : _remaining > 0
                  ? 'Remaining: ₵${_remaining.toStringAsFixed(2)}'
                  : 'Over by ₵${(-_remaining).toStringAsFixed(2)}',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: _remaining.abs() < 0.01
                    ? AppColors.success
                    : AppColors.danger,
              ),
            ),
            if (_exceedsCreditLimit)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.danger.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.error_outline,
                        size: 16,
                        color: AppColors.danger,
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          'Exceeds available credit of ₵${widget.customer!.availableCredit.toStringAsFixed(2)}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.danger,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
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
          onPressed: _canSubmit ? _submit : null,
          child: _submitting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(
                  _creditRequested > 0
                      ? 'Complete Credit Sale'
                      : 'Complete Sale',
                ),
        ),
      ],
    );
  }
}
