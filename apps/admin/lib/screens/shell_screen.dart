import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../auth_controller.dart';

class _NavItem {
  final String location;
  final IconData icon;
  final String label;
  final bool Function(AuthController) visible;
  const _NavItem(this.location, this.icon, this.label, this.visible);
}

final _navItems = <_NavItem>[
  _NavItem('/products', Icons.checkroom, 'Products', (_) => true),
  _NavItem('/inventory', Icons.inventory_2, 'Inventory', (_) => true),
  _NavItem('/orders', Icons.receipt_long, 'Orders', (_) => true),
  _NavItem(
    '/staff',
    Icons.people,
    'Staff',
    (auth) => auth.profile?.isOwner ?? false,
  ),
];

class AppShell extends StatelessWidget {
  final Widget child;
  final String location;
  const AppShell({super.key, required this.child, required this.location});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final items = _navItems.where((i) => i.visible(auth)).toList();
    final selectedIndex = items
        .indexWhere((i) => location.startsWith(i.location))
        .clamp(0, items.length - 1);

    return Scaffold(
      body: Row(
        children: [
          NavigationRail(
            extended: MediaQuery.of(context).size.width > 900,
            selectedIndex: selectedIndex < 0 ? 0 : selectedIndex,
            onDestinationSelected: (i) => context.go(items[i].location),
            leading: const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Icon(Icons.storefront),
            ),
            trailing: Expanded(
              child: Align(
                alignment: Alignment.bottomCenter,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: IconButton(
                    tooltip: 'Sign out (${auth.profile?.fullName ?? ''})',
                    icon: const Icon(Icons.logout),
                    onPressed: auth.signOut,
                  ),
                ),
              ),
            ),
            destinations: [
              for (final item in items)
                NavigationRailDestination(
                  icon: Icon(item.icon),
                  label: Text(item.label),
                ),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: child),
        ],
      ),
    );
  }
}
