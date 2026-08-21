/// The admin app's routes: /login and /set-password stand alone (a staff
/// member needs to reach these before -- or instead of -- the main app),
/// everything else sits behind one ShellRoute (persistent nav via
/// AppShell) and is gated by the redirect below on being signed in as
/// staff, not mid-password-recovery.
library;

import 'package:go_router/go_router.dart';

import 'auth_controller.dart';
import 'screens/categories_screen.dart';
import 'screens/customers_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/inventory_screen.dart';
import 'screens/log_sale_screen.dart';
import 'screens/login_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/products_screen.dart';
import 'screens/set_password_screen.dart';
import 'screens/shell_screen.dart';
import 'screens/staff_screen.dart';

GoRouter buildRouter(AuthController auth) {
  return GoRouter(
    initialLocation: '/products',
    refreshListenable: auth,
    redirect: (context, state) {
      final loggingIn = state.matchedLocation == '/login';
      final settingPassword = state.matchedLocation == '/set-password';
      if (auth.status != AuthStatus.signedIn) {
        return loggingIn ? null : '/login';
      }
      if (auth.passwordRecovery) {
        return settingPassword ? null : '/set-password';
      }
      if (loggingIn || settingPassword) return '/products';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/set-password',
        builder: (context, state) => const SetPasswordScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) =>
            AppShell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/log-sale',
            builder: (context, state) => const LogSaleScreen(),
          ),
          GoRoute(
            path: '/products',
            builder: (context, state) => const ProductsScreen(),
          ),
          GoRoute(
            path: '/categories',
            builder: (context, state) => const CategoriesScreen(),
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
            path: '/customers',
            builder: (context, state) => const CustomersScreen(),
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
