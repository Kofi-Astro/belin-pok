import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api_client.dart';
import '../theme.dart';
import '../widgets/announcement_bar.dart';
import '../widgets/category_showcase.dart';
import '../widgets/hero_banner.dart';
import '../widgets/product_card.dart';
import '../widgets/product_filters.dart';
import '../widgets/storefront_footer.dart';

/// The Shop tab body: hero, category showcase, search/filters, product
/// grid, footer -- a Shop/Cart/Account shell branch (see
/// widgets/app_shell.dart), not a standalone screen, so it renders its
/// content directly with no app bar/scaffold of its own. Category
/// selection is in-page filter state (_selectCategory below), not a
/// separate route -- there's no stable per-category URL to link to.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _api = StorefrontApiClient();
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();

  List<Category> _categories = [];
  List<Product> _products = [];
  String? _selectedCategoryId;
  ProductFilters _filters = const ProductFilters();
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
      final results = await Future.wait([
        _api.listCategories(),
        _api.listProducts(
          search: _searchController.text.trim().isEmpty
              ? null
              : _searchController.text.trim(),
          categoryId: _selectedCategoryId,
          minPrice: _filters.minPrice,
          maxPrice: _filters.maxPrice,
          inStockOnly: _filters.inStockOnly,
          sort: _filters.sort,
        ),
      ]);
      setState(() {
        _categories = results[0] as List<Category>;
        _products = results[1] as List<Product>;
        _loading = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  void _selectCategory(String? categoryId) {
    setState(() => _selectedCategoryId = categoryId);
    _load();
  }

  void _scrollToProducts() {
    if (!_scrollController.hasClients) return;
    // The hero + category showcase run a bit over one screen height on
    // most devices -- close enough to "jump past the fold" without
    // needing to measure the exact section heights.
    _scrollController.animateTo(
      _scrollController.position.maxScrollExtent.clamp(0, 900),
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeOut,
    );
  }

  void _scrollToTop() {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      0,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  @override
  void dispose() {
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  bool get _hasNarrowingCriteria =>
      _searchController.text.trim().isNotEmpty ||
      _selectedCategoryId != null ||
      _filters.isActive;

  String get _selectedCategoryName =>
      _categories
          .where((c) => c.id == _selectedCategoryId)
          .map((c) => c.name)
          .firstOrNull ??
      'All products';

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: CustomScrollView(
        controller: _scrollController,
        slivers: [
          const SliverToBoxAdapter(child: AnnouncementBar()),
          SliverToBoxAdapter(child: HeroBanner(onShopNow: _scrollToProducts)),
          SliverToBoxAdapter(
            child: CategoryShowcase(
              categories: _categories,
              selectedCategoryId: _selectedCategoryId,
              onSelect: _selectCategory,
            ),
          ),
          SliverToBoxAdapter(child: _buildSearchBar()),
          if (_loading)
            const SliverFillRemaining(
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            SliverFillRemaining(
              child: EmptyState(
                icon: Icons.wifi_off_rounded,
                title: 'Couldn\'t load products',
                message: _error!,
              ),
            )
          else if (_products.isEmpty)
            SliverFillRemaining(
              child: EmptyState(
                icon: _hasNarrowingCriteria
                    ? Icons.search_off_rounded
                    : Icons.storefront_outlined,
                title: _hasNarrowingCriteria
                    ? 'No matches here'
                    : 'New stock is on the way',
                message: _hasNarrowingCriteria
                    ? 'Try a different search, category, or filter.'
                    : 'We\'re setting up the shop -- check back soon for caps, tees, and more.',
              ),
            )
          else ...[
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
              sliver: SliverToBoxAdapter(child: _buildSectionHeader()),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              // A fixed childAspectRatio was tuned against wide desktop
              // cards and overflowed on phone-width columns: the card's
              // image scales with column width (AspectRatio 1) but its
              // text block underneath doesn't, so a ratio that leaves
              // enough room at 260px-wide desktop columns runs out of
              // room once columns narrow to phone width. Computing
              // mainAxisExtent from the actual column width plus a
              // fixed text-chrome allowance keeps that allowance
              // constant at every screen size instead.
              sliver: SliverLayoutBuilder(
                builder: (context, constraints) {
                  const maxCrossAxisExtent = 260.0;
                  const spacing = 16.0;
                  const cardChromeHeight = 92.0;
                  final crossAxisCount =
                      (constraints.crossAxisExtent / maxCrossAxisExtent)
                          .ceil()
                          .clamp(1, 999);
                  final cellWidth =
                      (constraints.crossAxisExtent -
                          spacing * (crossAxisCount - 1)) /
                      crossAxisCount;
                  return SliverGrid(
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: crossAxisCount,
                      mainAxisSpacing: spacing,
                      crossAxisSpacing: spacing,
                      mainAxisExtent: cellWidth + cardChromeHeight,
                    ),
                    delegate: SliverChildBuilderDelegate((context, index) {
                      final product = _products[index];
                      return ProductCard(
                        product: product,
                        onTap: () => context.push('/product/${product.id}'),
                      );
                    }, childCount: _products.length),
                  );
                },
              ),
            ),
          ],
          SliverToBoxAdapter(
            child: StorefrontFooter(
              categories: _categories,
              onCategoryTap: (categoryId) {
                _selectCategory(
                  _selectedCategoryId == categoryId ? null : categoryId,
                );
                _scrollToTop();
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader() {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1200),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Row(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _selectedCategoryName,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_products.length} item${_products.length == 1 ? '' : 's'}',
                    style: const TextStyle(color: StorefrontColors.inkMuted),
                  ),
                ],
              ),
              if (_selectedCategoryId != null) ...[
                const SizedBox(width: 12),
                TextButton(
                  onPressed: () => _selectCategory(null),
                  child: const Text('Clear'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1200),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: _searchController,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _load(),
                  decoration: InputDecoration(
                    hintText: 'Search products',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _searchController.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              _searchController.clear();
                              _load();
                            },
                          ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              _buildFilterButton(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterButton() {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: StorefrontColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFCBC6BB)),
          ),
          child: IconButton(
            tooltip: 'Filters',
            icon: const Icon(Icons.tune_rounded),
            onPressed: () async {
              final result = await showProductFiltersSheet(context, _filters);
              if (result == null) return;
              setState(() => _filters = result);
              _load();
            },
          ),
        ),
        if (_filters.isActive)
          Positioned(
            right: -2,
            top: -2,
            child: Container(
              padding: const EdgeInsets.all(3),
              constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
              decoration: const BoxDecoration(
                color: StorefrontColors.deepOrange,
                shape: BoxShape.circle,
              ),
              child: Text(
                '${_filters.activeCount}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
