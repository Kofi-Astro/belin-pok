/// The admin app's routes: /login and /set-password stand alone (a staff
/// member needs to reach these before -- or instead of -- the main app),
/// everything else sits behind one ShellRoute (persistent nav via
/// AppShell) and is gated by the redirect below on being signed in as
/// staff who doesn't still owe a password change.
///
/// /set-password serves two purposes:
/// - with `?token=...`: an invite or reset link opened from an email or a
///   shared message (see services/api/app/routers/auth.py's
///   create_one_time_link). Reachable signed out -- that's the point.
/// - without: the forced "choose a new password" step for an account
///   flagged must_change_password (the bootstrap owner).
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
      final hasLinkToken = state.uri.queryParameters.containsKey('token');
      // Still restoring a saved session: stay put rather than flash the
      // sign-in screen; refreshListenable re-runs this once it's known.
      if (auth.status == AuthStatus.unknown) return null;
      // An invite/reset link works whether or not someone is signed in on
      // this device (redeeming it signs them in as the link's owner).
      if (settingPassword && hasLinkToken) return null;
      if (auth.status != AuthStatus.signedIn) {
        return loggingIn ? null : '/login';
      }
      if (auth.mustChangePassword) {
        return settingPassword ? null : '/set-password';
      }
      if (loggingIn || settingPassword) return '/products';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/set-password',
        builder: (context, state) =>
            SetPasswordScreen(token: state.uri.queryParameters['token']),
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
