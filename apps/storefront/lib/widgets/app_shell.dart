import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../auth_controller.dart';
import '../cart.dart';
import '../theme.dart';
import 'responsive.dart';

/// The persistent chrome around the three primary sections (Shop, Cart,
/// Account) -- each a StatefulShellRoute branch, switched via
/// navigationShell.goBranch() rather than context.go()/push(). Branch
/// switching alone isn't enough to stop the "keeps stacking pages" report,
/// though: goBranch() still updates go_router's RouteInformationProvider
/// under the hood, and on web the Router framework reports that as a *new*
/// history entry (pushState) by default for any ordinary programmatic
/// navigation, branch switch or not. Router.neglect() tells the framework
/// to replace the current entry instead -- but only reliably for a branch's
/// *first* visit (internally a plain go()); revisiting an already-visited
/// branch resolves via a cached, asynchronously-restored match list, whose
/// report lands a frame later, outside Router.neglect's synchronous
/// window. Since all three branches here are flat single-route sections
/// with nothing nested to restore, passing initialLocation: true always
/// forces the plain-go() path for every switch, not just the first --
/// sidestepping the async restore() path entirely.
///
/// Web gets a conventional top bar (brand + account/cart icons); narrow
/// screens get a bottom nav bar instead, since a top-heavy icon row is a
/// worse fit for a one-handed phone than the tab bar shoppers already
/// know from every native app. Product detail and checkout are genuine
/// drill-downs with one sensible "back" each, so they stay as ordinary
/// pushed routes outside this shell instead of a fourth branch.
class AppShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const AppShell({super.key, required this.navigationShell});

  static const _shopIndex = 0;
  static const _cartIndex = 1;
  static const _accountIndex = 2;

  void _switchBranch(BuildContext context, int index) {
    Router.neglect(
      context,
      () => navigationShell.goBranch(index, initialLocation: true),
    );
  }

  @override
  Widget build(BuildContext context) {
    final wide = isWideScreen(context);
    final cart = context.watch<CartController>();
    final auth = context.watch<AuthController>();

    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          onTap: () => _switchBranch(context, _shopIndex),
          child: const Text(
            'Belin-Pok',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
        actions: wide
            ? [
                IconButton(
                  tooltip: auth.status == AuthStatus.signedIn
                      ? 'Account'
                      : 'Sign in',
                  icon: Icon(
                    auth.status == AuthStatus.signedIn
                        ? Icons.person
                        : Icons.person_outline,
                  ),
                  onPressed: () => _switchBranch(context, _accountIndex),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: _CartIcon(
                    itemCount: cart.itemCount,
                    onTap: () => _switchBranch(context, _cartIndex),
                  ),
                ),
              ]
            : null,
      ),
      body: navigationShell,
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: navigationShell.currentIndex,
              onDestinationSelected: (index) => _switchBranch(context, index),
              destinations: [
                const NavigationDestination(
                  icon: Icon(Icons.storefront_outlined),
                  selectedIcon: Icon(Icons.storefront),
                  label: 'Shop',
                ),
                NavigationDestination(
                  icon: Badge(
                    isLabelVisible: cart.itemCount > 0,
                    label: Text('${cart.itemCount}'),
                    child: const Icon(Icons.shopping_bag_outlined),
                  ),
                  selectedIcon: const Icon(Icons.shopping_bag),
                  label: 'Cart',
                ),
                NavigationDestination(
                  icon: Icon(
                    auth.status == AuthStatus.signedIn
                        ? Icons.person
                        : Icons.person_outline,
                  ),
                  selectedIcon: const Icon(Icons.person),
                  label: 'Account',
                ),
              ],
            ),
    );
  }
}

class _CartIcon extends StatelessWidget {
  final int itemCount;
  final VoidCallback onTap;

  const _CartIcon({required this.itemCount, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(
          tooltip: 'Cart',
          icon: const Icon(Icons.shopping_bag_outlined),
          onPressed: onTap,
        ),
        if (itemCount > 0)
          Positioned(
            right: 4,
            top: 4,
            child: Container(
              padding: const EdgeInsets.all(3),
              constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
              decoration: const BoxDecoration(
                color: StorefrontColors.deepOrange,
                shape: BoxShape.circle,
              ),
              child: Text(
                '$itemCount',
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
