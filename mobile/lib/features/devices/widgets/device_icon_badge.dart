import 'package:flutter/material.dart';

import '../../../models/device.dart';
import '../device_kind.dart';

/// The device's icon on a soft rounded square. An offline device gets a gray
/// square instead of the tinted one, so it reads as "not available" at a glance.
class DeviceIconBadge extends StatelessWidget {
  const DeviceIconBadge({
    super.key,
    required this.kind,
    required this.state,
    this.size = 48,
  });

  final DeviceKind kind;
  final OnlineState state;
  final double size;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final muted = state == OnlineState.offline;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: muted ? scheme.surfaceContainerHighest : scheme.primaryContainer,
        borderRadius: BorderRadius.circular(size * 0.32),
      ),
      child: Icon(
        kind.icon,
        size: size * 0.5,
        color: muted ? scheme.onSurfaceVariant : scheme.onPrimaryContainer,
      ),
    );
  }
}
