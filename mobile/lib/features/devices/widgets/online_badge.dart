import 'package:flutter/material.dart';

import '../../../models/device.dart';

/// Small "● Trực tuyến / Ngoại tuyến / Không rõ" indicator.
class OnlineBadge extends StatelessWidget {
  const OnlineBadge(this.state, {super.key});

  final OnlineState state;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (label, color) = switch (state) {
      OnlineState.online => ('Trực tuyến', const Color(0xFF2E7D32)),
      OnlineState.offline => ('Ngoại tuyến', scheme.error),
      OnlineState.unknown => ('Không rõ', scheme.outline),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.circle, size: 10, color: color),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600)),
      ],
    );
  }
}
