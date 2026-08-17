import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// The storefront's own brand palette -- deliberately bolder and distinct
/// from apps/admin's navy/amber (see belpok_core's theme.dart), at the
/// user's request: a public storefront selling caps/tees/jackets can
/// afford to be louder than an internal inventory tool. Deep purple
/// carries structure (app bar, headings, outlines) the way navy did;
/// deep orange is the action/accent color (buttons, prices, the
/// selected-chip state); gold is a sparing third accent for small
/// highlight moments (badges, the "new season" tag) so the page isn't
/// only ever purple-vs-orange.
class StorefrontColors {
  static const deepPurple = Color(0xFF4B2884);
  static const deepPurpleLight = Color(0xFF6B3FA8);
  static const deepOrange = Color(0xFFD14E0F);
  static const deepOrangeLight = Color(0xFFF07A3C);
  static const gold = Color(0xFFD4A017);
  static const canvas = Color(0xFFF7F3EF);
  static const surface = Color(0xFFFFFFFF);
  static const success = Color(0xFF2E9E6D);
  static const warning = Color(0xFFDDA02A);
  static const danger = Color(0xFFD24545);
  static const ink = Color(0xFF201A2B);
  static const inkMuted = Color(0xFF6E6478);
}

ThemeData buildStorefrontTheme() {
  final base = ThemeData(useMaterial3: true, brightness: Brightness.light);
  final textTheme = GoogleFonts.manropeTextTheme(
    base.textTheme,
  ).apply(bodyColor: StorefrontColors.ink, displayColor: StorefrontColors.ink);

  final colorScheme = base.colorScheme.copyWith(
    primary: StorefrontColors.deepPurple,
    onPrimary: Colors.white,
    secondary: StorefrontColors.deepOrange,
    onSecondary: Colors.white,
    tertiary: StorefrontColors.gold,
    onTertiary: Colors.white,
    surface: StorefrontColors.surface,
    onSurface: StorefrontColors.ink,
    error: StorefrontColors.danger,
  );

  return base.copyWith(
    colorScheme: colorScheme,
    scaffoldBackgroundColor: StorefrontColors.canvas,
    textTheme: textTheme,
    appBarTheme: AppBarTheme(
      backgroundColor: StorefrontColors.canvas,
      foregroundColor: StorefrontColors.ink,
      elevation: 0,
      scrolledUnderElevation: 1,
      titleTextStyle: textTheme.headlineSmall?.copyWith(
        fontWeight: FontWeight.w800,
      ),
    ),
    cardTheme: CardThemeData(
      color: StorefrontColors.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: StorefrontColors.deepPurple.withValues(alpha: 0.1),
        ),
      ),
      margin: EdgeInsets.zero,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: StorefrontColors.deepOrange,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: StorefrontColors.deepPurple,
        side: BorderSide(
          color: StorefrontColors.deepPurple.withValues(alpha: 0.35),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: StorefrontColors.deepPurple,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: StorefrontColors.deepOrange,
      foregroundColor: Colors.white,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: StorefrontColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(
          color: StorefrontColors.deepPurple.withValues(alpha: 0.2),
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(
          color: StorefrontColors.deepPurple.withValues(alpha: 0.2),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(
          color: StorefrontColors.deepOrange,
          width: 2,
        ),
      ),
      labelStyle: const TextStyle(color: StorefrontColors.inkMuted),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: StorefrontColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: StorefrontColors.deepPurple.withValues(alpha: 0.07),
      labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
      side: BorderSide.none,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    dividerTheme: DividerThemeData(
      color: StorefrontColors.deepPurple.withValues(alpha: 0.12),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: StorefrontColors.deepPurple,
      contentTextStyle: const TextStyle(color: Colors.white),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}
