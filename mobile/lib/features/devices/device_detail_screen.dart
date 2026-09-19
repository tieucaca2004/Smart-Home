import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/load_controller.dart';
import '../../core/widgets/state_views.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/control_kind.dart';
import '../../models/device.dart';
import '../../models/device_capabilities.dart';
import 'widgets/device_controls_section.dart';
import 'widgets/online_badge.dart';

/// Read-only details of one device. The basic facts come from the list entry
/// the user tapped; the capabilities are fetched from
/// `GET /api/devices/:id/capabilities`. There are no controls yet.
class DeviceDetailScreen extends StatefulWidget {
  const DeviceDetailScreen({super.key, required this.device, required this.client});

  final Device device;
  final HubApiClient client;

  @override
  State<DeviceDetailScreen> createState() => _DeviceDetailScreenState();
}

class _DeviceDetailScreenState extends State<DeviceDetailScreen> {
  late final LoadController<DeviceCapabilities> _capabilities;

  @override
  void initState() {
    super.initState();
    _capabilities = LoadController<DeviceCapabilities>(
      () => widget.client.fetchCapabilities(widget.device.id),
    )..load();
  }

  @override
  void dispose() {
    _capabilities.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final device = widget.device;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(device.displayName),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Tải lại thiết bị',
            onPressed: _capabilities.load,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (device.error != null) _LookupErrorBanner(message: device.error!),
          _InfoRow(label: 'Tên', value: device.displayName),
          _InfoRow(label: 'Mã thiết bị', value: device.id),
          _InfoRow(label: 'Loại', value: device.category ?? 'Chưa rõ'),
          _InfoRow(label: 'Giao thức / nguồn', value: device.protocol),
          _InfoRow(label: 'Mã gốc', value: device.nativeId),
          _InfoRow(label: 'Trạng thái', child: OnlineBadge(device.onlineState)),
          ListenableBuilder(
            listenable: _capabilities,
            builder: (context, _) => switch (_capabilities.state) {
              LoadSuccess(:final data) => _buildControls(data),
              LoadInProgress() || LoadFailure() => const SizedBox.shrink(),
            },
          ),
          const SizedBox(height: 24),
          Text('Khả năng của thiết bị', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          ListenableBuilder(
            listenable: _capabilities,
            builder: (context, _) => switch (_capabilities.state) {
              LoadInProgress() => const LoadingView(compact: true),
              LoadFailure(:final error) => _buildError(error),
              LoadSuccess(:final data) => _CapabilitiesView(data),
            },
          ),
        ],
      ),
    );
  }

  /// One switch per on/off command the device lists; nothing when it has none.
  Widget _buildControls(DeviceCapabilities capabilities) {
    final controls = <DeviceFunction>[
      for (final function in capabilities.commands)
        if (controlKindOf(function) == ControlKind.toggle) function,
    ];
    if (controls.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: DeviceControlsSection(
        // A new key per capabilities load: reloading re-reads the status too.
        key: ObjectKey(capabilities),
        client: widget.client,
        deviceId: widget.device.id,
        controls: controls,
        online: capabilities.online ?? widget.device.online,
      ),
    );
  }

  Widget _buildError(HubApiException error) {
    final text = describeHubError(error, hubUrl: widget.client.baseUrl);
    return ErrorView(
      compact: true,
      title: text.title,
      hint: text.hint,
      detail: text.detail,
      onRetry: _capabilities.load,
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, this.value, this.child})
      : assert(value != null || child != null, 'Provide a value or a child');

  final String label;
  final String? value;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
          Expanded(
            child: child ?? SelectableText(value!, style: theme.textTheme.bodyLarge),
          ),
        ],
      ),
    );
  }
}

class _LookupErrorBanner extends StatelessWidget {
  const _LookupErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(
          'Hub không lấy được thông tin thiết bị này: $message',
          style: TextStyle(color: scheme.onErrorContainer),
        ),
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
        const SizedBox(height: 16),
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
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              emptyText,
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
          )
        else
          for (final item in items) _FunctionTile(item),
      ],
    );
  }
}

class _FunctionTile extends StatelessWidget {
  const _FunctionTile(this.function);

  final DeviceFunction function;

  @override
  Widget build(BuildContext context) {
    final label = function.name;
    final details = <String>[
      if (label != null) function.code,
      function.type,
      if (function.constraintSummary != null) function.constraintSummary!,
    ];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      title: Text(label ?? function.code),
      subtitle: Text(details.join(' · ')),
    );
  }
}
