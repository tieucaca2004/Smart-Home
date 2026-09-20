import 'package:flutter/material.dart';

import '../../../core/branding.dart';
import '../../../core/theme/app_palette.dart';
import '../../../core/theme/app_tokens.dart';
import '../device_summary.dart';
import 'section_card.dart';

/// The top of the home screen: a greeting, the app's name, the refresh action
/// and, once the devices are known, one line about the whole home plus the
/// summary tiles.
class DashboardHeader extends StatelessWidget {
  const DashboardHeader({
    super.key,
    required this.greeting,
    required this.onRefresh,
    this.summary,
  });

  final String greeting;
  final VoidCallback onRefresh;

  /// null while the devices are not known (loading, error, none).
  final DeviceSummary? summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final known = summary;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    greeting,
                    style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 2),
                  Text(appTitle, style: theme.textTheme.headlineMedium),
                ],
              ),
            ),
            IconButton.filledTonal(
              onPressed: onRefresh,
              tooltip: 'Tải lại',
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        if (known != null && known.total > 0) ...[
          const SizedBox(height: AppSpacing.md),
          _Overview(known),
          const SizedBox(height: AppSpacing.lg),
          DeviceSummaryRow(known),
        ],
      ],
    );
  }
}

/// "● Mọi thiết bị đều đang trực tuyến": green when all is well, amber when
/// something needs a look.
class _Overview extends StatelessWidget {
  const _Overview(this.summary);

  final DeviceSummary summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppPalette.of(context);
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: summary.allOnline ? palette.success : palette.warning,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Flexible(
          child: Text(
            summary.overview,
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
      ],
    );
  }
}

/// Three tiles: all devices, online, offline.
class DeviceSummaryRow extends StatelessWidget {
  const DeviceSummaryRow(this.summary, {super.key});

  final DeviceSummary summary;

  @override
  Widget build(BuildContext context) {
    final palette = AppPalette.of(context);
    return Row(
      children: [
        Expanded(child: _StatTile(value: summary.total, label: 'thiết bị')),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: _StatTile(value: summary.online, label: 'trực tuyến', dot: palette.success),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: _StatTile(value: summary.offline, label: 'ngoại tuyến', dot: palette.offline),
        ),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.value, required this.label, this.dot});

  final int value;
  final String label;

  /// The status color shown before the label; none for the total.
  final Color? dot;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return MergeSemantics(
      child: SectionCard(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Scaled down, never cut off or overflowing, on narrow screens
            // and with large fonts.
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text('$value', style: theme.textTheme.headlineSmall),
            ),
            const SizedBox(height: 2),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (dot != null) ...[
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 6),
                  ],
                  Text(
                    label,
                    style: theme.textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
