import 'package:flutter/material.dart';

import '../../../core/load_controller.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../models/device.dart';
import '../../../models/device_capabilities.dart';
import '../labels/function_labels.dart';
import 'section_card.dart';

/// "Thông tin kỹ thuật": everything a developer or an installer wants (ids,
/// category, protocol, the commands and statuses the device lists) in one
/// card that starts folded, so it never competes with the controls.
///
/// Nothing the app uses for debugging is removed: it is all here once the card
/// is opened. The capabilities come from [capabilities], the same load the
/// controls are built from, so opening the card starts no request.
class TechnicalInfoSection extends StatefulWidget {
  const TechnicalInfoSection({
    super.key,
    required this.device,
    required this.capabilities,
  });

  final Device device;
  final LoadController<DeviceCapabilities> capabilities;

  @override
  State<TechnicalInfoSection> createState() => _TechnicalInfoSectionState();
}

class _TechnicalInfoSectionState extends State<TechnicalInfoSection> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            expanded: _expanded,
            child: InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.lg,
                  vertical: AppSpacing.lg,
                ),
                child: Row(
                  children: [
                    Icon(Icons.info_outline_rounded, size: 20, color: scheme.onSurfaceVariant),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Text('Thông tin kỹ thuật', style: theme.textTheme.titleSmall),
                    ),
                    AnimatedRotation(
                      turns: _expanded ? 0.5 : 0,
                      duration: AppMotion.fast,
                      child: Icon(Icons.expand_more_rounded, color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ),
          ),
          AnimatedSize(
            duration: AppMotion.fast,
            curve: Curves.easeOut,
            alignment: Alignment.topCenter,
            child: _expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      0,
                      AppSpacing.lg,
                      AppSpacing.lg,
                    ),
                    child: _Details(device: widget.device, capabilities: widget.capabilities),
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({required this.device, required this.capabilities});

  final Device device;
  final LoadController<DeviceCapabilities> capabilities;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(),
        const SizedBox(height: AppSpacing.sm),
        _InfoRow(label: 'Mã thiết bị', value: device.id),
        _InfoRow(label: 'Loại', value: device.category ?? 'Chưa rõ'),
        _InfoRow(label: 'Giao thức / nguồn', value: device.protocol),
        _InfoRow(label: 'Mã gốc', value: device.nativeId),
        const SizedBox(height: AppSpacing.sm),
        const Divider(),
        const SizedBox(height: AppSpacing.md),
        ListenableBuilder(
          listenable: capabilities,
          builder: (context, _) => switch (capabilities.state) {
            LoadInProgress() => const _Muted('Đang tải lệnh và trạng thái…'),
            LoadFailure() => const _Muted('Chưa tải được lệnh và trạng thái của thiết bị.'),
            LoadSuccess(:final data) => _CapabilitiesView(data),
          },
        ),
      ],
    );
  }
}

class _Muted extends StatelessWidget {
  const _Muted(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      text,
      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
          Expanded(
            child: SelectableText(value, style: theme.textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }
}

class _CapabilitiesView extends StatelessWidget {
  const _CapabilitiesView(this.capabilities);

  final DeviceCapabilities capabilities;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _FunctionSection(
          title: 'Lệnh thiết bị hỗ trợ',
          emptyText: 'Thiết bị không có lệnh điều khiển nào.',
          items: capabilities.commands,
        ),
        const SizedBox(height: AppSpacing.lg),
        _FunctionSection(
          title: 'Trạng thái thiết bị báo về',
          emptyText: 'Thiết bị không báo trạng thái nào.',
          items: capabilities.statuses,
        ),
      ],
    );
  }
}

class _FunctionSection extends StatelessWidget {
  const _FunctionSection({
    required this.title,
    required this.emptyText,
    required this.items,
  });

  final String title;
  final String emptyText;
  final List<DeviceFunction> items;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: theme.textTheme.titleSmall),
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Text(
              emptyText,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          )
        else
          for (final item in items) _FunctionTile(item),
      ],
    );
  }
}

/// One command or status in the technical list: the friendly label when there
/// is one (the raw code otherwise), with the code, type and limits beneath.
class _FunctionTile extends StatelessWidget {
  const _FunctionTile(this.function);

  final DeviceFunction function;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = friendlyFunctionLabel(function);
    final details = <String>[
      if (label != null) function.code,
      function.type,
      if (function.constraintSummary != null) function.constraintSummary!,
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label ?? function.code, style: theme.textTheme.bodyMedium),
          const SizedBox(height: 2),
          Text(
            details.join(' · '),
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
