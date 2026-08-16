import 'package:belpok_core/belpok_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';
import 'auth_controller.dart';
import 'cart.dart';
import 'config.dart';
import 'router.dart';

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
  late final GoRouter _router = buildRouter(_auth);

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _auth),
        ChangeNotifierProvider.value(value: _cart),
      ],
      child: MaterialApp.router(
        title: 'Belin-Pok',
        theme: buildAppTheme(),
        routerConfig: _router,
      ),
    );
  }
}
