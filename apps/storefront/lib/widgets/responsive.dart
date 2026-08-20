import 'package:flutter/widgets.dart';

/// One breakpoint, used everywhere the storefront renders a genuinely
/// different layout for wide (desktop/web) vs narrow (phone) screens --
/// not just reflowing the same widgets, but different sections
/// (hero, category browse, footer).
const kWideBreakpoint = 900.0;

bool isWideScreen(BuildContext context) =>
    MediaQuery.sizeOf(context).width >= kWideBreakpoint;
