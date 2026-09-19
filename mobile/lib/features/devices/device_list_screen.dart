import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/load_controller.dart';
import '../../core/widgets/state_views.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/device.dart';
import 'device_detail_screen.dart';
import 'widgets/online_badge.dart';

/// "Thiết bị": every device the Hub knows about, fetched live from
/// `GET /api/devices`.
class DeviceListScreen extends StatefulWidget {
  const DeviceListScreen({super.key, required this.client});

  final HubApiClient client;

  @override
  State<DeviceListScreen> createState() => _DeviceListScreenState();
}

class _DeviceListScreenState extends State<DeviceListScreen> {
  late final LoadController<List<Device>> _controller;

  @override
  void initState() {
    super.initState();
    _controller = LoadController<List<Device>>(widget.client.fetchDevices)..load();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _openDetail(Device device) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DeviceDetailScreen(device: device, client: widget.client),
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
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: devices.length,
        separatorBuilder: (_, index) => const Divider(height: 1),
        itemBuilder: (_, index) => _DeviceTile(
          device: devices[index],
          onTap: () => _openDetail(devices[index]),
        ),
      ),
    );
  }
}

class _DeviceTile extends StatelessWidget {
  const _DeviceTile({required this.device, required this.onTap});

  final Device device;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final hasError = device.error != null;
    final subtitle = hasError
        ? 'Không lấy được thông tin thiết bị · ${device.protocol}'
        : '${device.category ?? 'Chưa rõ loại'} · ${device.protocol}';

    return ListTile(
      leading: const Icon(Icons.devices_other_outlined),
      title: Text(device.displayName),
      subtitle: Text(
        subtitle,
        style: hasError ? TextStyle(color: scheme.error) : null,
      ),
      trailing: OnlineBadge(device.onlineState),
      onTap: onTap,
    );
  }
}
