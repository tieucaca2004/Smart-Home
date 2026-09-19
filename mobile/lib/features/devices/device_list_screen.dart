import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/load_controller.dart';
import '../../core/widgets/state_views.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/device.dart';
import 'device_detail_screen.dart';
import 'device_name_store.dart';
import 'widgets/online_badge.dart';
import 'widgets/section_card.dart';

/// "Thiết bị": every device the Hub knows about, fetched live from
/// `GET /api/devices`, one card each.
///
/// [nameStore] holds the names the user gave their devices; a device without
/// one shows the name the Hub reports. Without a store, that is every device.
class DeviceListScreen extends StatefulWidget {
  const DeviceListScreen({super.key, required this.client, this.nameStore});

  final HubApiClient client;
  final DeviceNameStore? nameStore;

  @override
  State<DeviceListScreen> createState() => _DeviceListScreenState();
}

class _DeviceListScreenState extends State<DeviceListScreen> {
  late final LoadController<List<Device>> _controller;
  InMemoryDeviceNameStore? _ownNames;

  /// The store given by the app, or an empty one owned by this screen, so the
  /// list and the detail screens it opens always share one.
  DeviceNameStore get _names => widget.nameStore ?? (_ownNames ??= InMemoryDeviceNameStore());

  @override
  void initState() {
    super.initState();
    _controller = LoadController<List<Device>>(widget.client.fetchDevices)..load();
  }

  @override
  void dispose() {
    _controller.dispose();
    _ownNames?.dispose();
    super.dispose();
  }

  void _openDetail(Device device) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DeviceDetailScreen(
          device: device,
          client: widget.client,
          nameStore: _names,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Thiết bị'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Tải lại',
            onPressed: _controller.load,
          ),
        ],
      ),
      body: ListenableBuilder(
        listenable: _controller,
        builder: (context, _) => switch (_controller.state) {
          LoadInProgress() => const LoadingView(),
          LoadFailure(:final error) => _buildError(error),
          LoadSuccess(:final data) => _buildList(data),
        },
      ),
    );
  }

  Widget _buildError(HubApiException error) {
    final text = describeHubError(error, hubUrl: widget.client.baseUrl);
    return ErrorView(
      title: text.title,
      hint: text.hint,
      detail: text.detail,
      onRetry: _controller.load,
    );
  }

  Widget _buildList(List<Device> devices) {
    if (devices.isEmpty) {
      return EmptyView(
        title: 'Hub chưa có thiết bị nào',
        hint: 'Hãy thêm thiết bị vào Hub rồi tải lại.',
        onReload: _controller.load,
      );
    }
    return RefreshIndicator(
      onRefresh: _controller.refresh,
      child: ListenableBuilder(
        listenable: _names,
        builder: (context, _) => ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          itemCount: devices.length,
          separatorBuilder: (_, index) => const SizedBox(height: 8),
          itemBuilder: (_, index) => _DeviceTile(
            device: devices[index],
            name: deviceDisplayName(devices[index], _names),
            onTap: () => _openDetail(devices[index]),
          ),
        ),
      ),
    );
  }
}

class _DeviceTile extends StatelessWidget {
  const _DeviceTile({required this.device, required this.name, required this.onTap});

  final Device device;
  final String name;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hasError = device.error != null;
    final subtitle = hasError
        ? 'Không lấy được thông tin thiết bị · ${device.protocol}'
        : '${device.category ?? 'Chưa rõ loại'} · ${device.protocol}';

    return SectionCard(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: scheme.primaryContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(Icons.devices_other_outlined, color: scheme.onPrimaryContainer),
        ),
        title: Text(
          name,
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              OnlineBadge(device.onlineState),
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: hasError ? TextStyle(color: scheme.error) : null,
              ),
            ],
          ),
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
