import 'package:flutter/material.dart';

import '../../../core/theme/app_palette.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../models/device.dart';

/// "● Trực tuyến / Ngoại tuyến / Không rõ": a small dot and a quiet label.
///
/// Online is a subtle green, offline a muted red, unknown a neutral gray.
/// With [pill] the same indicator sits on a soft tinted capsule (used on the
/// device's own screen, where it is the headline status).
class OnlineBadge extends StatelessWidget {
  const OnlineBadge(this.state, {super.key, this.pill = false});

  final OnlineState state;
  final bool pill;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final palette = AppPalette.of(context);
    final (label, dot, text, background) = switch (state) {
      OnlineState.online => (
          'Trực tuyến',
          palette.success,
          palette.onSuccessContainer,
          palette.successContainer,
        ),
      OnlineState.offline => (
          'Ngoại tuyến',
          palette.offline,
          palette.onOfflineContainer,
          palette.offlineContainer,
        ),
      OnlineState.unknown => (
          'Không rõ',
          scheme.outline,
          scheme.onSurfaceVariant,
          scheme.surfaceContainerHighest,
        ),
    };

    final content = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Flexible(
          child: Text(label, style: theme.textTheme.labelMedium?.copyWith(color: text)),
        ),
      ],
    );

    if (!pill) return content;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: content,
    );
  }
}
