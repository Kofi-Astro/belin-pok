import 'package:belpok_core/belpok_core.dart';
import 'package:go_router/go_router.dart';

import 'auth_controller.dart';
import 'screens/account_screen.dart';
import 'screens/auth_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/checkout_screen.dart';
import 'screens/home_screen.dart';
import 'screens/order_confirmation_screen.dart';
import 'screens/product_detail_screen.dart';

GoRouter buildRouter(AuthController auth) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: auth,
    redirect: (context, state) {
      // Only /account requires a signed-in customer -- browsing, cart, and
      // guest checkout stay open with no account at all (unlike the admin
      // app, where everything is gated behind staff sign-in).
      if (state.matchedLocation != '/account') return null;
      if (auth.status == AuthStatus.unknown) return null;
      final signedIn =
          auth.status == AuthStatus.signedIn ||
          auth.status == AuthStatus.needsRegistration;
      return signedIn ? null : '/login';
    },
    routes: [
      GoRoute(path: '/', builder: (context, state) => const HomeScreen()),
      GoRoute(
        path: '/product/:id',
        builder: (context, state) =>
            ProductDetailScreen(productId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/cart', builder: (context, state) => const CartScreen()),
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
      GoRoute(
        path: '/account',
        builder: (context, state) => const AccountScreen(),
      ),
    ],
  );
}
