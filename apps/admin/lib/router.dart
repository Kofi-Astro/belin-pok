import 'package:go_router/go_router.dart';

import 'auth_controller.dart';
import 'screens/inventory_screen.dart';
import 'screens/login_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/products_screen.dart';
import 'screens/shell_screen.dart';
import 'screens/staff_screen.dart';

GoRouter buildRouter(AuthController auth) {
  return GoRouter(
    initialLocation: '/products',
    refreshListenable: auth,
    redirect: (context, state) {
      final loggingIn = state.matchedLocation == '/login';
      if (auth.status != AuthStatus.signedIn) {
        return loggingIn ? null : '/login';
      }
      if (loggingIn) return '/products';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      ShellRoute(
        builder: (context, state, child) =>
            AppShell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(
            path: '/products',
            builder: (context, state) => const ProductsScreen(),
          ),
          GoRoute(
            path: '/inventory',
            builder: (context, state) => const InventoryScreen(),
          ),
          GoRoute(
            path: '/orders',
            builder: (context, state) => const OrdersScreen(),
          ),
          GoRoute(
            path: '/staff',
            builder: (context, state) => const StaffScreen(),
          ),
        ],
      ),
    ],
  );
}
