/// Storefront app entry point: initializes Supabase Auth, then wires up
/// the two app-wide ChangeNotifiers (AuthController, CartController --
/// see those files) via Provider and hands the router (router.dart) to
/// MaterialApp.router.
library;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';
import 'auth_controller.dart';
import 'cart.dart';
import 'config.dart';
import 'router.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    publishableKey: AppConfig.supabasePublishableKey,
  );
  runApp(const StorefrontApp());
}

class StorefrontApp extends StatefulWidget {
  const StorefrontApp({super.key});

  @override
  State<StorefrontApp> createState() => _StorefrontAppState();
}

class _StorefrontAppState extends State<StorefrontApp> {
  late final AuthController _auth = AuthController(StorefrontApiClient());
  late final CartController _cart = CartController();
  late final GoRouter _router = buildRouter();

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _auth),
        ChangeNotifierProvider.value(value: _cart),
      ],
      child: MaterialApp.router(
        title: 'Belin-Pok',
        theme: buildStorefrontTheme(),
        routerConfig: _router,
      ),
    );
  }
}
