import 'package:flutter/material.dart';

import '../../../core/hub_error_message.dart';
import '../../../data/hub_api_client.dart';
import '../../../models/device_capabilities.dart';
import '../control_messages.dart';
import '../device_control_controller.dart';
import '../labels/function_labels.dart';
import 'section_card.dart';

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
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Điều khiển',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
            if (!_offline)
              IconButton(
                icon: const Icon(Icons.sync),
                tooltip: 'Đọc lại trạng thái',
                onPressed: _controller.loadStatus,
              ),
          ],
        ),
        if (_offline) const _Notice(offlineDeviceNotice),
        ListenableBuilder(
          listenable: _controller,
          builder: (context, _) {
            final statusError = _controller.statusError;
            final tiles = <Widget>[];
            for (final function in widget.controls) {
              if (tiles.isNotEmpty) tiles.add(const Divider(height: 1));
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
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (statusError != null)
                  _Notice(
                    '$statusUnavailableText '
                    '${describeHubError(statusError, hubUrl: widget.client.baseUrl).title}.',
                  ),
                SectionCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: tiles,
                  ),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}

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

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(functionLabel(function), style: theme.textTheme.titleMedium),
                const SizedBox(height: 2),
                Text(
                  functionTechnicalLine(function),
                  style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 6),
                Text(
                  state,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: isOn ? scheme.primary : scheme.onSurfaceVariant,
                    fontWeight: isOn ? FontWeight.w600 : null,
                  ),
                ),
                ?_outcomeText(context, controller.outcomeOf(code)),
              ],
            ),
          ),
          const SizedBox(width: 12),
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
        width: 24,
        height: 24,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    }
    if (value is bool) {
      return Switch(
        key: ValueKey('toggle-$code'),
        value: value,
        onChanged: (next) => controller.setValue(code, next),
      );
    }
    // The device has not reported this code, so a switch would have to guess
    // its position. Offer explicit commands instead.
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextButton(
          key: ValueKey('on-$code'),
          onPressed: () => controller.setValue(code, true),
          child: const Text('Bật'),
        ),
        TextButton(
          key: ValueKey('off-$code'),
          onPressed: () => controller.setValue(code, false),
          child: const Text('Tắt'),
        ),
      ],
    );
  }

  Widget? _outcomeText(BuildContext context, ControlOutcome? outcome) {
    final scheme = Theme.of(context).colorScheme;
    return switch (outcome) {
      null => null,
      ControlConfirmed() => Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            'Thiết bị đã xác nhận.',
            style: TextStyle(color: scheme.primary),
          ),
        ),
      final ControlUnconfirmed unconfirmed => Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            unconfirmedText(unconfirmed),
            style: TextStyle(color: scheme.tertiary),
          ),
        ),
      ControlFailed(:final error) => Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            commandFailureText(error),
            style: TextStyle(color: scheme.error),
          ),
        ),
    };
  }
}

/// A warning card shown above the controls.
class _Notice extends StatelessWidget {
  const _Notice(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(text, style: TextStyle(color: scheme.onErrorContainer)),
      ),
    );
  }
}
