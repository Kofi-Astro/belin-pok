import 'package:flutter/material.dart';

/// A little visual variety for the category rail -- keyed by the slugs
/// seeded in supabase/seed.sql, with a sensible fallback for anything
/// else (a new category a staff member adds later still renders fine,
/// just with the generic icon).
IconData categoryIcon(String slug) {
  switch (slug) {
    case 'caps':
      return Icons.sports_baseball;
    case 't-shirts':
      return Icons.checkroom;
    case 'jackets':
      return Icons.dry_cleaning;
    case 'sweatshirts':
      return Icons.local_laundry_service;
    case 'shorts':
      return Icons.beach_access;
    case 'joggers':
      return Icons.directions_run;
    case 'boxers':
    case 'socks':
      return Icons.checkroom;
    default:
      return Icons.category_outlined;
  }
}
