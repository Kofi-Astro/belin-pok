/// Admin app entry point: wires up AuthController (which restores any
/// saved session in the background -- see AuthSession) via Provider and hands the router (router.dart) to
/// MaterialApp.router. See apps/storefront/lib/main.dart for the
/// customer-facing counterpart of this same shape.
library;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'api_client.dart';
import 'auth_controller.dart';
import 'router.dart';
import 'session.dart';
import 'theme.dart';

void main() {
  runApp(const AdminApp());
}

class AdminApp extends StatefulWidget {
  const AdminApp({super.key});

  @override
  State<AdminApp> createState() => _AdminAppState();
}

class _AdminAppState extends State<AdminApp> {
  late final AuthController _auth = AuthController(ApiClient(), authSession);
  late final GoRouter _router = buildRouter(_auth);

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: _auth,
      child: MaterialApp.router(
        title: 'Belin-Pok Admin',
        theme: buildAppTheme(),
        routerConfig: _router,
      ),
    );
  }
}
