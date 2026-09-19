import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/load_controller.dart';
import '../../core/widgets/state_views.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/control_kind.dart';
import '../../models/device.dart';
import '../../models/device_capabilities.dart';
import 'device_name_store.dart';
import 'labels/function_labels.dart';
import 'widgets/device_controls_section.dart';
import 'widgets/online_badge.dart';
import 'widgets/section_card.dart';

/// One device: who it is and whether it is reachable, its controls, and, last
/// and in quieter type, the technical details. The basic facts come from the
/// list entry the user tapped; the capabilities are fetched from
/// `GET /api/devices/:id/capabilities`.
///
/// [nameStore] holds the names the user gave their devices. Without one the
/// device shows the name the Hub reports.
class DeviceDetailScreen extends StatefulWidget {
  const DeviceDetailScreen({
    super.key,
    required this.device,
    required this.client,
    this.nameStore,
  });

  final Device device;
  final HubApiClient client;
  final DeviceNameStore? nameStore;

  @override
  State<DeviceDetailScreen> createState() => _DeviceDetailScreenState();
}

class _DeviceDetailScreenState extends State<DeviceDetailScreen> {
  late final LoadController<DeviceCapabilities> _capabilities;
  InMemoryDeviceNameStore? _ownNames;

  DeviceNameStore get _names => widget.nameStore ?? (_ownNames ??= InMemoryDeviceNameStore());

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
    _ownNames?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final device = widget.device;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Chi tiết thiết bị'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Tải lại thiết bị',
            onPressed: _capabilities.load,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          if (device.error != null) _LookupErrorBanner(message: device.error!),
          ListenableBuilder(
            listenable: _names,
            builder: (context, _) => _DeviceHeader(
              device: device,
              name: deviceDisplayName(device, _names),
            ),
          ),
          ListenableBuilder(
            listenable: _capabilities,
            builder: (context, _) => switch (_capabilities.state) {
              LoadSuccess(:final data) => _buildControls(data),
              LoadInProgress() || LoadFailure() => const SizedBox.shrink(),
            },
          ),
          const SizedBox(height: 24),
          Text(
            'Thông tin kỹ thuật',
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          SectionCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _InfoRow(label: 'Mã thiết bị', value: device.id),
                _InfoRow(label: 'Loại', value: device.category ?? 'Chưa rõ'),
                _InfoRow(label: 'Giao thức / nguồn', value: device.protocol),
                _InfoRow(label: 'Mã gốc', value: device.nativeId),
                const Divider(height: 24),
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

/// The device's name, whether it is online, and, when the user renamed it,
/// the name it came with.
class _DeviceHeader extends StatelessWidget {
  const _DeviceHeader({required this.device, required this.name});

  final Device device;
  final String name;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final originalName = name == device.displayName ? null : device.displayName;

    return SectionCard(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(Icons.devices_other_outlined, size: 28, color: scheme.onPrimaryContainer),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                OnlineBadge(device.onlineState),
                if (originalName != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Tên gốc: $originalName',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
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
            width: 130,
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

/// One command or status in the technical list: the friendly label when there
/// is one (the raw code otherwise), with the code, type and limits beneath.
class _FunctionTile extends StatelessWidget {
  const _FunctionTile(this.function);

  final DeviceFunction function;

  @override
  Widget build(BuildContext context) {
    final label = friendlyFunctionLabel(function);
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
