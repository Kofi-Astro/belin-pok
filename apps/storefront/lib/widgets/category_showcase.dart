import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';

import '../theme.dart';
import 'category_icon.dart';
import 'responsive.dart';

/// The primary way to browse by category -- a grid of tappable tiles
/// (icon + name) rather than a plain scrolling chip row, so the homepage
/// reads as a real shop floor with sections instead of a search form.
/// This replaces the chip row as the actual filter control; the section
/// header below still shows which category is active with a way to
/// clear it, for once a shopper has scrolled past this section.
class CategoryShowcase extends StatelessWidget {
  final List<Category> categories;
  final String? selectedCategoryId;
  final ValueChanged<String?> onSelect;

  const CategoryShowcase({
    super.key,
    required this.categories,
    required this.selectedCategoryId,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) return const SizedBox.shrink();
    final wide = isWideScreen(context);

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1200),
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, wide ? 32 : 20, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Shop by category',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 14),
              LayoutBuilder(
                builder: (context, constraints) {
                  const tileMin = 118.0;
                  const spacing = 12.0;
                  final columns = (constraints.maxWidth / tileMin)
                      .floor()
                      .clamp(3, 8);
                  return GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisSpacing: spacing,
                      crossAxisSpacing: spacing,
                      childAspectRatio: 1,
                    ),
                    itemCount: categories.length,
                    itemBuilder: (context, index) {
                      final category = categories[index];
                      return _CategoryTile(
                        category: category,
                        selected: category.id == selectedCategoryId,
                        onTap: () => onSelect(
                          selectedCategoryId == category.id
                              ? null
                              : category.id,
                        ),
                      );
                    },
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CategoryTile extends StatefulWidget {
  final Category category;
  final bool selected;
  final VoidCallback onTap;

  const _CategoryTile({
    required this.category,
    required this.selected,
    required this.onTap,
  });

  @override
  State<_CategoryTile> createState() => _CategoryTileState();
}

class _CategoryTileState extends State<_CategoryTile> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    final selected = widget.selected;
    final background = selected
        ? StorefrontColors.deepPurple
        : StorefrontColors.surface;
    final foreground = selected ? Colors.white : StorefrontColors.deepPurple;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovering = true),
      onExit: (_) => setState(() => _hovering = false),
      cursor: SystemMouseCursors.click,
      child: AnimatedScale(
        scale: _hovering ? 1.05 : 1.0,
        duration: const Duration(milliseconds: 140),
        curve: Curves.easeOut,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: selected
                  ? StorefrontColors.deepPurple
                  : StorefrontColors.deepPurple.withValues(alpha: 0.12),
            ),
            boxShadow: _hovering
                ? [
                    BoxShadow(
                      color: StorefrontColors.deepPurple.withValues(
                        alpha: 0.18,
                      ),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                    ),
                  ]
                : const [],
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: widget.onTap,
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      categoryIcon(widget.category.slug),
                      size: 26,
                      color: foreground,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      widget.category.name,
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 12.5,
                        color: selected ? Colors.white : StorefrontColors.ink,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
