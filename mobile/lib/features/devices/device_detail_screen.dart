import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/load_controller.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/state_views.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/control_kind.dart';
import '../../models/device.dart';
import '../../models/device_capabilities.dart';
import 'device_kind.dart';
import 'device_name_store.dart';
import 'widgets/device_controls_section.dart';
import 'widgets/device_icon_badge.dart';
import 'widgets/online_badge.dart';
import 'widgets/section_card.dart';
import 'widgets/technical_info_section.dart';

/// One device: who it is and whether it is reachable, then its controls, then,
/// folded and in quieter type, the technical details. The basic facts come
/// from the list entry the user tapped; the capabilities are fetched from
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

    return Scaffold(
      appBar: AppBar(
        title: const Text('Chi tiết thiết bị'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Tải lại thiết bị',
            onPressed: _capabilities.load,
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screen,
            AppSpacing.sm,
            AppSpacing.screen,
            AppSpacing.xxl,
          ),
          children: [
            ListenableBuilder(
              listenable: _names,
              builder: (context, _) => _DeviceHeader(
                device: device,
                name: deviceDisplayName(device, _names),
              ),
            ),
            if (device.error != null) ...[
              const SizedBox(height: AppSpacing.md),
              _LookupErrorBanner(message: device.error!),
            ],
            const SizedBox(height: AppSpacing.xl),
            ListenableBuilder(
              listenable: _capabilities,
              builder: (context, _) => switch (_capabilities.state) {
                LoadInProgress() => const SectionCard(
                    child: LoadingView(compact: true, message: 'Đang tải điều khiển…'),
                  ),
                LoadFailure(:final error) => SectionCard(child: _buildError(error)),
                LoadSuccess(:final data) => _buildControls(data),
              },
            ),
            const SizedBox(height: AppSpacing.xl),
            TechnicalInfoSection(device: device, capabilities: _capabilities),
          ],
        ),
      ),
    );
  }

  /// One switch per on/off command the device lists; a short note when it has none.
  Widget _buildControls(DeviceCapabilities capabilities) {
    final controls = <DeviceFunction>[
      for (final function in capabilities.commands)
        if (controlKindOf(function) == ControlKind.toggle) function,
    ];
    if (controls.isEmpty) return const _NoControlsNote();
    return DeviceControlsSection(
      // A new key per capabilities load: reloading re-reads the status too.
      key: ObjectKey(capabilities),
      client: widget.client,
      deviceId: widget.device.id,
      controls: controls,
      online: capabilities.online ?? widget.device.online,
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

/// The device's icon, its name, whether it is online, its type and, when the
/// user renamed it, the name it came with.
class _DeviceHeader extends StatelessWidget {
  const _DeviceHeader({required this.device, required this.name});

  final Device device;
  final String name;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final kind = deviceKindOf(device);
    final originalName = name == device.displayName ? null : device.displayName;

    return SectionCard(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Row(
        children: [
          DeviceIconBadge(kind: kind, state: device.onlineState, size: 64),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: theme.textTheme.titleLarge),
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    OnlineBadge(device.onlineState, pill: true),
                    Text(
                      kind.label,
                      style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
                if (originalName != null) ...[
                  const SizedBox(height: AppSpacing.sm),
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

class _LookupErrorBanner extends StatelessWidget {
  const _LookupErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline_rounded, size: 20, color: scheme.onErrorContainer),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              'Hub không lấy được thông tin thiết bị này: $message',
              style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onErrorContainer),
            ),
          ),
        ],
      ),
    );
  }
}

/// Shown instead of the controls when the device lists no on/off command, so
/// the screen does not look broken.
class _NoControlsNote extends StatelessWidget {
  const _NoControlsNote();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SectionCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        children: [
          Icon(Icons.tune_rounded, size: 20, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              'Thiết bị này chưa có điều khiển bật/tắt trong ứng dụng.',
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}
