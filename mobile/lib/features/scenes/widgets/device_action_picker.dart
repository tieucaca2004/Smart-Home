import 'package:flutter/material.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/state_views.dart';
import '../../../data/hub_api_client.dart';
import '../../../models/control_kind.dart';
import '../../../models/device.dart';
import '../../../models/device_capabilities.dart';
import '../../../models/scene.dart';
import '../../devices/device_kind.dart';
import '../../devices/labels/function_labels.dart';
import '../../devices/widgets/device_icon_badge.dart';
import '../../devices/widgets/online_badge.dart';

/// The action [pickDeviceAction] built, plus the friendly text to show it
/// with right away (the editor has no reason to re-fetch the device/function
/// it was just picked from).
class PickedSceneAction {
  const PickedSceneAction({required this.action, required this.deviceName, required this.functionLabel});

  final SceneAction action;
  final String deviceName;
  final String functionLabel;
}

/// Pushes the "add action" flow (pick a device → pick one of its Boolean
/// commands → pick ON/OFF) and returns what it built, or null if the person
/// backed out at any step.
///
/// Never offers a command that is not Boolean (MVP scope) and never invents
/// a device or a code: everything comes from `GET /api/devices` and
/// `GET /api/devices/:id/capabilities`, exactly as the device screens use them.
Future<PickedSceneAction?> pickDeviceAction(BuildContext context, HubApiClient client) {
  return Navigator.of(context).push<PickedSceneAction>(
    MaterialPageRoute(builder: (_) => _DevicePickerScreen(client: client)),
  );
}

class _DevicePickerScreen extends StatefulWidget {
  const _DevicePickerScreen({required this.client});

  final HubApiClient client;

  @override
  State<_DevicePickerScreen> createState() => _DevicePickerScreenState();
}

class _DevicePickerScreenState extends State<_DevicePickerScreen> {
  late Future<List<Device>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.client.fetchDevices();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Chọn thiết bị')),
      body: FutureBuilder<List<Device>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const LoadingView(message: 'Đang tải danh sách thiết bị…');
          }
          if (snapshot.hasError) {
            return ErrorView(
              title: 'Không tải được danh sách thiết bị',
              hint: 'Hãy thử lại.',
              detail: snapshot.error.toString(),
              onRetry: () => setState(() => _future = widget.client.fetchDevices()),
            );
          }
          final devices = snapshot.data!;
          if (devices.isEmpty) {
            return const EmptyView(
              title: 'Chưa có thiết bị nào',
              hint: 'Hãy thêm thiết bị vào Hub trước.',
              onReload: _noop,
            );
          }
          return ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            itemCount: devices.length,
            itemBuilder: (context, index) {
              final device = devices[index];
              final kind = deviceKindOf(device);
              return ListTile(
                leading: DeviceIconBadge(kind: kind, state: device.onlineState, size: 40),
                title: Text(device.displayName),
                subtitle: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [OnlineBadge(device.onlineState), const SizedBox(width: AppSpacing.sm), Text(kind.label)],
                ),
                onTap: () async {
                  final picked = await Navigator.of(context).push<PickedSceneAction>(
                    MaterialPageRoute(
                      builder: (_) => _CommandPickerScreen(client: widget.client, device: device),
                    ),
                  );
                  if (picked != null && context.mounted) Navigator.of(context).pop(picked);
                },
              );
            },
          );
        },
      ),
    );
  }

  static void _noop() {}
}

class _CommandPickerScreen extends StatefulWidget {
  const _CommandPickerScreen({required this.client, required this.device});

  final HubApiClient client;
  final Device device;

  @override
  State<_CommandPickerScreen> createState() => _CommandPickerScreenState();
}

class _CommandPickerScreenState extends State<_CommandPickerScreen> {
  late Future<DeviceCapabilities> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.client.fetchCapabilities(widget.device.id);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.device.displayName)),
      body: FutureBuilder<DeviceCapabilities>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const LoadingView(message: 'Đang tải danh sách lệnh…');
          }
          if (snapshot.hasError) {
            final message = snapshot.error is Exception ? snapshot.error.toString() : 'Lỗi không xác định';
            return ErrorView(
              title: 'Không tải được lệnh của thiết bị',
              hint: 'Hãy thử lại.',
              detail: message,
              onRetry: () => setState(() => _future = widget.client.fetchCapabilities(widget.device.id)),
            );
          }
          final toggles = <DeviceFunction>[
            for (final function in snapshot.data!.commands)
              if (controlKindOf(function) == ControlKind.toggle) function,
          ];
          if (toggles.isEmpty) {
            return const EmptyView(
              title: 'Thiết bị này không có lệnh bật/tắt',
              hint: 'Hãy chọn thiết bị khác.',
              onReload: _noop,
            );
          }
          return ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            itemCount: toggles.length,
            itemBuilder: (context, index) {
              final function = toggles[index];
              return ListTile(
                key: ValueKey('pick-command-${function.code}'),
                title: Text(functionLabel(function)),
                subtitle: Text(functionTechnicalLine(function)),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () async {
                  final value = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => _ValuePickerScreen(function: function),
                    ),
                  );
                  if (value != null && context.mounted) {
                    Navigator.of(context).pop(
                      PickedSceneAction(
                        action: SceneAction(deviceId: widget.device.id, functionCode: function.code, value: value),
                        deviceName: widget.device.displayName,
                        functionLabel: functionLabel(function),
                      ),
                    );
                  }
                },
              );
            },
          );
        },
      ),
    );
  }

  static void _noop() {}
}

class _ValuePickerScreen extends StatelessWidget {
  const _ValuePickerScreen({required this.function});

  final DeviceFunction function;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(functionLabel(function))),
      body: Padding(
        padding: const EdgeInsets.all(AppSpacing.screen),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Khi cảnh chạy, đặt trạng thái này thành:', style: theme.textTheme.bodyMedium),
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              key: const ValueKey('pick-value-on'),
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Bật'),
            ),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton(
              key: const ValueKey('pick-value-off'),
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Tắt'),
            ),
          ],
        ),
      ),
    );
  }
}
