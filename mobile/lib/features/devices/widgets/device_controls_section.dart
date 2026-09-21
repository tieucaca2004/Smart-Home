import 'package:flutter/material.dart';

import '../../../core/hub_error_message.dart';
import '../../../core/theme/app_palette.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../data/hub_api_client.dart';
import '../../../models/device_capabilities.dart';
import '../control_messages.dart';
import '../device_control_controller.dart';
import '../labels/function_labels.dart';
import 'section_title.dart';

/// "Điều khiển": one switch per on/off command the device's capabilities
/// list. It is generated from [controls] (never from a fixed list of codes)
/// and knows nothing about the protocol behind the Hub.
///
/// Each control shows a friendly Vietnamese label as its main text, with the
/// technical code and type (`switch_1 · Boolean`) as secondary text and the
/// state the device reports underneath.
///
/// The parent gives it a fresh key whenever the capabilities are reloaded, so
/// the state below is created once per set of capabilities.
class DeviceControlsSection extends StatefulWidget {
  const DeviceControlsSection({
    super.key,
    required this.client,
    required this.deviceId,
    required this.controls,
    required this.online,
  });

  final HubApiClient client;
  final String deviceId;

  /// The command capabilities that have a control (see `controlKindOf`).
  final List<DeviceFunction> controls;

  /// Whether the Hub says the device is online; null = it did not say.
  final bool? online;

  @override
  State<DeviceControlsSection> createState() => _DeviceControlsSectionState();
}

class _DeviceControlsSectionState extends State<DeviceControlsSection> {
  late final DeviceControlController _controller;

  bool get _offline => widget.online == false;

  @override
  void initState() {
    super.initState();
    _controller = DeviceControlController(client: widget.client, deviceId: widget.deviceId);
    if (!_offline) _controller.loadStatus();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionTitle(
          'Điều khiển',
          trailing: _offline
              ? null
              : IconButton(
                  icon: const Icon(Icons.sync_rounded),
                  tooltip: 'Đọc lại trạng thái',
                  onPressed: _controller.loadStatus,
                ),
        ),
        const SizedBox(height: AppSpacing.sm),
        if (_offline) const _Notice(offlineDeviceNotice, tone: _NoticeTone.offline),
        ListenableBuilder(
          listenable: _controller,
          builder: (context, _) {
            final statusError = _controller.statusError;
            final tiles = <Widget>[];
            for (final function in widget.controls) {
              if (tiles.isNotEmpty) tiles.add(const SizedBox(height: AppSpacing.md));
              tiles.add(
                _ToggleTile(
                  key: ValueKey('control-${function.code}'),
                  function: function,
                  controller: _controller,
                  offline: _offline,
                ),
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (statusError != null)
                  _Notice(
                    '$statusUnavailableText '
                    '${describeHubError(statusError, hubUrl: widget.client.baseUrl).title}.',
                    tone: _NoticeTone.warning,
                  ),
                ...tiles,
              ],
            );
          },
        ),
      ],
    );
  }
}

/// One control: a card with a power icon, the label, the state the device
/// reports, the technical code as quiet secondary text, and the switch.
///
/// It looks different in each state so none needs reading to be understood:
/// on is tinted, off is neutral, pending shows a spinner in place of the
/// switch, offline is muted with no switch at all.
class _ToggleTile extends StatelessWidget {
  const _ToggleTile({
    super.key,
    required this.function,
    required this.controller,
    required this.offline,
  });

  final DeviceFunction function;
  final DeviceControlController controller;
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final code = function.code;
    final value = controller.valueOf(code);
    final pending = controller.isPending(code);
    final firstRead = controller.isReadingStatus && controller.status == null;

    final String state;
    if (pending) {
      state = 'Đang gửi lệnh…';
    } else if (offline) {
      state = 'Thiết bị ngoại tuyến';
    } else if (value is bool) {
      state = value ? 'Đang bật' : 'Đang tắt';
    } else if (firstRead) {
      state = 'Đang đọc trạng thái…';
    } else {
      state = 'Không rõ trạng thái';
    }
    final isOn = !pending && !offline && value == true;

    return AnimatedContainer(
      duration: AppMotion.fast,
      curve: Curves.easeOut,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.lg),
      decoration: BoxDecoration(
        color: isOn ? scheme.primaryContainer.withValues(alpha: 0.5) : scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
          color: isOn ? scheme.primary.withValues(alpha: 0.35) : scheme.outlineVariant,
        ),
      ),
      child: Row(
        children: [
          _PowerIcon(on: isOn, muted: offline),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(functionLabel(function), style: theme.textTheme.titleMedium),
                const SizedBox(height: 2),
                Text(
                  state,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: isOn ? scheme.primary : scheme.onSurfaceVariant,
                    fontWeight: isOn ? FontWeight.w600 : null,
                  ),
                ),
                ?_outcomeText(context, controller.outcomeOf(code)),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  functionTechnicalLine(function),
                  style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          ?_trailing(pending: pending, firstRead: firstRead, value: value),
        ],
      ),
    );
  }

  Widget? _trailing({required bool pending, required bool firstRead, required Object? value}) {
    final code = function.code;
    if (offline) return null;
    if (pending || (firstRead && value == null)) {
      return const SizedBox(
        width: 28,
        height: 28,
        child: CircularProgressIndicator(strokeWidth: 2.5),
      );
    }
    if (value is bool) {
      // A larger switch: this is what the person came here to press.
      return Transform.scale(
        scale: 1.15,
        child: Semantics(
          label: functionLabel(function),
          child: Switch(
            key: ValueKey('toggle-$code'),
            value: value,
            onChanged: (next) => controller.setValue(code, next),
          ),
        ),
      );
    }
    // The device has not reported this code, so a switch would have to guess
    // its position. Offer explicit commands instead.
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        MergeSemantics(
          child: Semantics(
            label: functionLabel(function),
            child: TextButton(
              key: ValueKey('on-$code'),
              style: TextButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: () => controller.setValue(code, true),
              child: const Text('Bật'),
            ),
          ),
        ),
        MergeSemantics(
          child: Semantics(
            label: functionLabel(function),
            child: TextButton(
              key: ValueKey('off-$code'),
              style: TextButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: () => controller.setValue(code, false),
              child: const Text('Tắt'),
            ),
          ),
        ),
      ],
    );
  }

  Widget? _outcomeText(BuildContext context, ControlOutcome? outcome) {
    final scheme = Theme.of(context).colorScheme;
    final palette = AppPalette.of(context);
    final style = Theme.of(context).textTheme.bodySmall;
    return switch (outcome) {
      null => null,
      ControlConfirmed() => Padding(
          padding: const EdgeInsets.only(top: AppSpacing.xs),
          child: Text(
            'Thiết bị đã xác nhận.',
            style: style?.copyWith(color: palette.onSuccessContainer),
          ),
        ),
      final ControlUnconfirmed unconfirmed => Padding(
          padding: const EdgeInsets.only(top: AppSpacing.xs),
          child: Text(
            unconfirmedText(unconfirmed),
            style: style?.copyWith(color: palette.onWarningContainer),
          ),
        ),
      ControlFailed(:final error) => Padding(
          padding: const EdgeInsets.only(top: AppSpacing.xs),
          child: Text(
            commandFailureText(error),
            style: style?.copyWith(color: scheme.error),
          ),
        ),
    };
  }
}

/// The round power icon at the start of a control: filled when on.
class _PowerIcon extends StatelessWidget {
  const _PowerIcon({required this.on, required this.muted});

  final bool on;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AnimatedContainer(
      duration: AppMotion.fast,
      width: 44,
      height: 44,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: on ? scheme.primary : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppRadius.md - 2),
      ),
      child: Icon(
        Icons.power_settings_new_rounded,
        size: 24,
        color: on
            ? scheme.onPrimary
            : (muted ? scheme.outline : scheme.onSurfaceVariant),
      ),
    );
  }
}

enum _NoticeTone { offline, warning }

/// A notice shown above the controls: the device is offline, or its status
/// could not be read.
class _Notice extends StatelessWidget {
  const _Notice(this.text, {required this.tone});

  final String text;
  final _NoticeTone tone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppPalette.of(context);
    final (background, foreground, icon) = switch (tone) {
      _NoticeTone.offline => (
          palette.offlineContainer,
          palette.onOfflineContainer,
          Icons.wifi_off_rounded,
        ),
      _NoticeTone.warning => (
          palette.warningContainer,
          palette.onWarningContainer,
          Icons.info_outline_rounded,
        ),
    };
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: foreground),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(text, style: theme.textTheme.bodyMedium?.copyWith(color: foreground)),
          ),
        ],
      ),
    );
  }
}
