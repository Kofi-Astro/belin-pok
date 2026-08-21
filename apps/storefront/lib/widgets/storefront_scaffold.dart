import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../auth_controller.dart';
import '../cart.dart';
import '../theme.dart';

/// The app bar for the four screens that live outside the main
/// StatefulShellRoute (product detail, checkout, order confirmation,
/// auth) -- see widgets/app_shell.dart for the Shop/Cart/Account tabs'
/// own chrome, which these deliberately don't share. Each of these four
/// is a genuine drill-down with one sensible "previous screen" reached
/// via context.push(), so it gets a real back arrow (showBackButton);
/// the account/cart icons here still use context.go() to jump straight
/// to a top-level tab, same as tapping the brand name to go home.
class StorefrontScaffold extends StatelessWidget {
  final Widget body;
  final bool showBackButton;

  const StorefrontScaffold({
    super.key,
    required this.body,
    this.showBackButton = false,
  });

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartController>();
    final auth = context.watch<AuthController>();

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: showBackButton,
        title: GestureDetector(
          onTap: () => context.go('/'),
          child: const Text(
            'Belin-Pok',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
        actions: [
          IconButton(
            tooltip: auth.status == AuthStatus.signedIn ? 'Account' : 'Sign in',
            icon: Icon(
              auth.status == AuthStatus.signedIn
                  ? Icons.person
                  : Icons.person_outline,
            ),
            onPressed: () => context.go(
              auth.status == AuthStatus.signedIn ? '/account' : '/login',
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                IconButton(
                  tooltip: 'Cart',
                  icon: const Icon(Icons.shopping_bag_outlined),
                  onPressed: () => context.go('/cart'),
                ),
                if (cart.itemCount > 0)
                  Positioned(
                    right: 4,
                    top: 4,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      constraints: const BoxConstraints(
                        minWidth: 16,
                        minHeight: 16,
                      ),
                      decoration: const BoxDecoration(
                        color: StorefrontColors.deepOrange,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '${cart.itemCount}',
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
            ),
          ),
        ],
      ),
      body: body,
    );
  }
}
