import 'package:belpok_core/belpok_core.dart';
import 'package:go_router/go_router.dart';

import 'screens/account_screen.dart';
import 'screens/auth_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/checkout_screen.dart';
import 'screens/home_screen.dart';
import 'screens/order_confirmation_screen.dart';
import 'screens/product_detail_screen.dart';
import 'widgets/app_shell.dart';

GoRouter buildRouter() {
  return GoRouter(
    initialLocation: '/',
    routes: [
      // Shop/Cart/Account are branches of one shell (AppShell), switched
      // via navigationShell.goBranch() -- not context.go()/push(). See
      // AppShell's doc comment for why that distinction is what actually
      // stops navigation from "stacking" on web (a fresh browser-history
      // entry per go()/push(), even when the in-app stack itself didn't
      // grow) as well as on a phone (no ever-deepening back stack to pop
      // through switching between the three primary sections).
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/',
                builder: (context, state) => const HomeScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/cart',
                builder: (context, state) => const CartScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/account',
                builder: (context, state) => const AccountScreen(),
              ),
            ],
          ),
        ],
      ),
      // Genuine drill-downs -- each has exactly one sensible "previous
      // screen" to pop back to, so these stay ordinary pushed routes with
      // a working back arrow, outside the shell.
      GoRoute(
        path: '/product/:id',
        builder: (context, state) =>
            ProductDetailScreen(productId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/checkout',
        builder: (context, state) => const CheckoutScreen(),
      ),
      GoRoute(
        path: '/order-confirmation',
        // extra doesn't survive a hard refresh (go_router limitation) --
        // fall back to home rather than crash on a null cast if someone
        // lands here directly.
        redirect: (context, state) => state.extra is Order ? null : '/',
        builder: (context, state) =>
            OrderConfirmationScreen(order: state.extra as Order),
      ),
      GoRoute(path: '/login', builder: (context, state) => const AuthScreen()),
    ],
  );
}
