import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../auth_controller.dart';
import '../theme.dart';
import '../widgets/change_password_dialog.dart';

class _NavItem {
  final String location;
  final IconData icon;
  final String label;
  final bool Function(AuthController) visible;
  const _NavItem(this.location, this.icon, this.label, this.visible);
}

final _navItems = <_NavItem>[
  _NavItem(
    '/dashboard',
    Icons.dashboard_outlined,
    'Dashboard',
    (auth) => auth.profile?.canManageInventory ?? false,
  ),
  _NavItem(
    '/log-sale',
    Icons.point_of_sale,
    'Log Sale',
    (auth) => auth.profile?.canAdjustStock ?? false,
  ),
  _NavItem('/products', Icons.checkroom, 'Products', (_) => true),
  _NavItem('/inventory', Icons.inventory_2, 'Inventory', (_) => true),
  _NavItem('/orders', Icons.receipt_long, 'Orders', (_) => true),
  _NavItem('/customers', Icons.people_alt_outlined, 'Customers', (_) => true),
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

  Future<void> _changePassword(BuildContext context, AuthController auth) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => ChangePasswordDialog(auth: auth),
    );
    if (changed == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password updated')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final items = _navItems.where((i) => i.visible(auth)).toList();
    final selectedIndex = items
        .indexWhere((i) => location.startsWith(i.location))
        .clamp(0, items.length - 1);
    final extended = MediaQuery.of(context).size.width > 900;

    return Scaffold(
      body: Row(
        children: [
          Container(
            width: extended ? 220 : 84,
            color: AppColors.navy,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 24, 16, 20),
                  child: Row(
                    mainAxisAlignment: extended
                        ? MainAxisAlignment.start
                        : MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.amber,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Icon(
                          Icons.storefront,
                          color: Colors.white,
                          size: 22,
                        ),
                      ),
                      if (extended) ...[
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Text(
                            'Belin-Pok',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Expanded(
                  child: NavigationRail(
                    backgroundColor: AppColors.navy,
                    extended: extended,
                    minExtendedWidth: 220,
                    selectedIndex: selectedIndex < 0 ? 0 : selectedIndex,
                    onDestinationSelected: (i) => context.go(items[i].location),
                    destinations: [
                      for (final item in items)
                        NavigationRailDestination(
                          icon: Icon(item.icon),
                          label: Text(item.label),
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    vertical: 20,
                    horizontal: 12,
                  ),
                  child: extended
                      ? Row(
                          children: [
                            CircleAvatar(
                              radius: 16,
                              backgroundColor: AppColors.amber,
                              child: Text(
                                (auth.profile?.fullName.isNotEmpty ?? false)
                                    ? auth.profile!.fullName[0].toUpperCase()
                                    : '?',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                auth.profile?.fullName ?? '',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                            IconButton(
                              tooltip: 'Change password',
                              icon: const Icon(
                                Icons.key_outlined,
                                color: Colors.white70,
                                size: 20,
                              ),
                              onPressed: () => _changePassword(context, auth),
                            ),
                            IconButton(
                              tooltip: 'Sign out',
                              icon: const Icon(
                                Icons.logout,
                                color: Colors.white70,
                                size: 20,
                              ),
                              onPressed: auth.signOut,
                            ),
                          ],
                        )
                      : Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: 'Change password',
                              icon: const Icon(
                                Icons.key_outlined,
                                color: Colors.white70,
                              ),
                              onPressed: () => _changePassword(context, auth),
                            ),
                            IconButton(
                              tooltip: 'Sign out',
                              icon: const Icon(
                                Icons.logout,
                                color: Colors.white70,
                              ),
                              onPressed: auth.signOut,
                            ),
                          ],
                        ),
                ),
              ],
            ),
          ),
          Expanded(child: child),
        ],
      ),
    );
  }
}
