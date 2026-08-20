import 'package:flutter/material.dart';

import '../theme.dart';

/// A thin strip above the fold stating real, current capabilities --
/// delivery/pickup and pay-on-fulfillment -- the kind of trust-building
/// line most storefronts lead with, kept honest to what checkout
/// actually offers today (no "free shipping" or promo that isn't real).
class AnnouncementBar extends StatelessWidget {
  const AnnouncementBar({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: StorefrontColors.ink,
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: const Center(
        child: Text(
          'Delivery across Ghana or pick up in-store  ·  Pay on delivery or pickup',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white,
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.1,
          ),
        ),
      ),
    );
  }
}
