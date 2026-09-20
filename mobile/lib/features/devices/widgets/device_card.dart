import 'package:flutter/material.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../models/device.dart';
import '../device_kind.dart';
import 'device_icon_badge.dart';
import 'online_badge.dart';
import 'section_card.dart';

/// One device on the home screen. A glance answers four questions, in this
/// order: what is it (icon), what is it called, is it reachable, can I open it.
///
/// Technical facts (category code, protocol, native id) are deliberately not
/// here; they live in the device's own screen.
class DeviceCard extends StatelessWidget {
  const DeviceCard({
    super.key,
    required this.device,
    required this.name,
    required this.onTap,
  });

  final Device device;

  /// The name to show (a custom name, or the one the Hub reports).
  final String name;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final kind = deviceKindOf(device);
    final state = device.onlineState;
    final offline = state == OnlineState.offline;
    final hasError = device.error != null;

    return SectionCard(
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.xs,
        ),
        minVerticalPadding: AppSpacing.md,
        horizontalTitleGap: AppSpacing.md,
        leading: DeviceIconBadge(kind: kind, state: state),
        title: Text(
          name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.titleMedium?.copyWith(
            color: offline ? scheme.onSurfaceVariant : scheme.onSurface,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: AppSpacing.xs + 2),
          // A Wrap, so a narrow screen or a large font moves the type onto its
          // own line instead of overflowing.
          child: Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OnlineBadge(state),
              _TypeLabel(
                text: hasError ? 'Không lấy được thông tin thiết bị' : kind.label,
                isError: hasError,
              ),
            ],
          ),
        ),
        trailing: Icon(Icons.chevron_right_rounded, color: scheme.outline),
      ),
    );
  }
}

/// "· Công tắc": the device's type, after a small separator dot.
class _TypeLabel extends StatelessWidget {
  const _TypeLabel({required this.text, required this.isError});

  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final color = isError ? scheme.error : scheme.onSurfaceVariant;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 3,
          height: 3,
          decoration: BoxDecoration(color: scheme.outline, shape: BoxShape.circle),
        ),
        const SizedBox(width: AppSpacing.sm),
        Flexible(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(color: color),
          ),
        ),
      ],
    );
  }
}
