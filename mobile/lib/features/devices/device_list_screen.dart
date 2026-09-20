import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/load_controller.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/state_views.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/device.dart';
import 'device_detail_screen.dart';
import 'device_name_store.dart';
import 'device_summary.dart';
import 'widgets/dashboard_header.dart';
import 'widgets/device_card.dart';
import 'widgets/section_title.dart';

/// The home screen: a greeting and a summary of the home, then "Thiết bị",
/// every device the Hub knows about, fetched live from `GET /api/devices`,
/// one card each.
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
      body: SafeArea(
        child: ListenableBuilder(
          listenable: _controller,
          builder: (context, _) => switch (_controller.state) {
            LoadInProgress() => _buildFrame(const LoadingView(message: 'Đang tải thiết bị…')),
            LoadFailure(:final error) => _buildFrame(_buildError(error)),
            LoadSuccess(:final data) => _buildList(data),
          },
        ),
      ),
    );
  }

  /// The screen when there is no list to show (loading, error, empty): the
  /// header and the "Thiết bị" heading on top, the state below.
  Widget _buildFrame(Widget content) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screen,
            AppSpacing.lg,
            AppSpacing.screen,
            0,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DashboardHeader(
                greeting: greetingFor(DateTime.now()),
                onRefresh: _controller.load,
              ),
              const SizedBox(height: AppSpacing.xl),
              const SectionTitle('Thiết bị'),
            ],
          ),
        ),
        Expanded(child: content),
      ],
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
      return _buildFrame(
        EmptyView(
          title: 'Hub chưa có thiết bị nào',
          hint: 'Hãy thêm thiết bị vào Hub rồi tải lại.',
          onReload: _controller.load,
        ),
      );
    }
    final summary = DeviceSummary.of(devices);
    return RefreshIndicator(
      onRefresh: _controller.refresh,
      child: ListenableBuilder(
        listenable: _names,
        builder: (context, _) => ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screen,
            AppSpacing.lg,
            AppSpacing.screen,
            AppSpacing.xxl,
          ),
          // Item 0 is the header (it scrolls away with the list); the devices follow.
          itemCount: devices.length + 1,
          itemBuilder: (context, index) {
            if (index == 0) {
              return Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    DashboardHeader(
                      greeting: greetingFor(DateTime.now()),
                      onRefresh: _controller.load,
                      summary: summary,
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    const SectionTitle('Thiết bị'),
                  ],
                ),
              );
            }
            final device = devices[index - 1];
            return Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: DeviceCard(
                key: ValueKey('device-${device.id}'),
                device: device,
                name: deviceDisplayName(device, _names),
                onTap: () => _openDetail(device),
              ),
            );
          },
        ),
      ),
    );
  }
}
