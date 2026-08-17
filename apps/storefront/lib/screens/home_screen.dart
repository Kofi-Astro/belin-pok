import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api_client.dart';
import '../theme.dart';
import '../widgets/category_icon.dart';
import '../widgets/hero_banner.dart';
import '../widgets/product_card.dart';
import '../widgets/storefront_footer.dart';
import '../widgets/storefront_scaffold.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _api = StorefrontApiClient();
  final _searchController = TextEditingController();

  List<Category> _categories = [];
  List<Product> _products = [];
  String? _selectedCategoryId;
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

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String get _selectedCategoryName =>
      _categories
          .where((c) => c.id == _selectedCategoryId)
          .map((c) => c.name)
          .firstOrNull ??
      'All products';

  @override
  Widget build(BuildContext context) {
    return StorefrontScaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            const SliverToBoxAdapter(child: HeroBanner()),
            SliverToBoxAdapter(child: _buildSearchBar()),
            SliverToBoxAdapter(child: _buildCategoryChips()),
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
                  icon:
                      _searchController.text.trim().isNotEmpty ||
                          _selectedCategoryId != null
                      ? Icons.search_off_rounded
                      : Icons.storefront_outlined,
                  title:
                      _searchController.text.trim().isNotEmpty ||
                          _selectedCategoryId != null
                      ? 'No matches here'
                      : 'New stock is on the way',
                  message:
                      _searchController.text.trim().isNotEmpty ||
                          _selectedCategoryId != null
                      ? 'Try a different search or category.'
                      : 'We\'re setting up the shop -- check back soon for caps, tees, and more.',
                ),
              )
            else ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 28, 16, 12),
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
                    final crossAxisCount = (constraints.crossAxisExtent / maxCrossAxisExtent)
                        .ceil()
                        .clamp(1, 999);
                    final cellWidth =
                        (constraints.crossAxisExtent - spacing * (crossAxisCount - 1)) /
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
            const SliverToBoxAdapter(child: StorefrontFooter()),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader() {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1200),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Column(
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
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
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
    );
  }

  Widget _buildCategoryChips() {
    if (_categories.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              avatar: const Icon(Icons.apps_rounded, size: 18),
              label: const Text('All'),
              selected: _selectedCategoryId == null,
              onSelected: (_) {
                setState(() => _selectedCategoryId = null);
                _load();
              },
            ),
          ),
          ..._categories.map(
            (category) => Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                avatar: Icon(categoryIcon(category.slug), size: 18),
                label: Text(category.name),
                selected: _selectedCategoryId == category.id,
                onSelected: (_) {
                  setState(
                    () => _selectedCategoryId =
                        _selectedCategoryId == category.id ? null : category.id,
                  );
                  _load();
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
