import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/features/devices/device_detail_screen.dart';
import 'package:tieu_home/models/device.dart';

import '../../support/fake_hub.dart';
import '../../support/fixtures.dart';

Future<void> pumpDetail(WidgetTester tester, FakeHub hub, Device device) async {
  tester.view.physicalSize = const Size(800, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(home: DeviceDetailScreen(device: device, client: hub.apiClient())),
  );
}

void main() {
  const lamp = Device(
    id: lampDeviceId,
    nativeId: 'abc123',
    protocol: 'matter',
    name: 'Đèn phòng khách',
    category: 'light',
    online: false,
  );

  testWidgets('shows the device facts without depending on the protocol', (tester) async {
    final hub = FakeHub()
      ..respond('/api/devices/$lampDeviceId/capabilities', {
        'id': lampDeviceId,
        'capabilities': {
          'id': lampDeviceId,
          'protocol': 'matter',
          'nativeId': 'abc123',
          'commands': <Object>[],
          'statuses': <Object>[],
        },
      });

    await pumpDetail(tester, hub, lamp);
    await tester.pumpAndSettle();

    expect(find.text('Đèn phòng khách'), findsWidgets);
    expect(find.text(lampDeviceId), findsOneWidget);
    expect(find.text('matter'), findsOneWidget);
    expect(find.text('light'), findsOneWidget);
    expect(find.text('Ngoại tuyến'), findsOneWidget);
    expect(find.text('Thiết bị không có lệnh điều khiển nào.'), findsOneWidget);
    expect(find.text('Thiết bị không báo trạng thái nào.'), findsOneWidget);
  });

  testWidgets('a capabilities failure is shown inline and can be retried', (tester) async {
    final hub = FakeHub()
      ..respond(
        '/api/devices/$lampDeviceId/capabilities',
        {'error': 'Device not found', 'code': 'DEVICE_NOT_FOUND', 'id': lampDeviceId},
        404,
      );

    await pumpDetail(tester, hub, lamp);
    await tester.pumpAndSettle();

    // The basics are still there, with the error next to them.
    expect(find.text(lampDeviceId), findsOneWidget);
    expect(find.text('Hub không tìm thấy thiết bị này'), findsOneWidget);
    expect(find.text('Thử lại'), findsOneWidget);

    hub.respond('/api/devices/$lampDeviceId/capabilities', {
      'id': lampDeviceId,
      'capabilities': {
        'id': lampDeviceId,
        'commands': [
          {'code': 'on_off', 'type': 'Boolean', 'values': <String, Object?>{}},
        ],
      },
    });
    await tester.tap(find.text('Thử lại'));
    await tester.pumpAndSettle();

    expect(find.text('Hub không tìm thấy thiết bị này'), findsNothing);
    expect(find.text('on_off'), findsOneWidget);
  });

  testWidgets('a device the Hub could not look up shows that clearly', (tester) async {
    const broken = Device(
      id: brokenDeviceId,
      nativeId: 'broken',
      protocol: 'tuya',
      error: 'Upstream lookup failed',
    );
    final hub = FakeHub()..failNetwork('/api/devices/$brokenDeviceId/capabilities');

    await pumpDetail(tester, hub, broken);
    await tester.pumpAndSettle();

    expect(find.textContaining('Upstream lookup failed'), findsOneWidget);
    expect(find.text('Không rõ'), findsOneWidget);
    expect(find.text('Chưa rõ'), findsOneWidget);
  });
}
