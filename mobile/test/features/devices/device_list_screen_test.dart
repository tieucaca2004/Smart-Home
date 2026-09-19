import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:tieu_home/app.dart';

import '../../support/fake_hub.dart';
import '../../support/fixtures.dart';

Future<void> pumpApp(WidgetTester tester, FakeHub hub) async {
  await tester.pumpWidget(TieuHomeApp(client: hub.apiClient()));
}

void main() {
  testWidgets('shows a spinner while loading, then the real devices', (tester) async {
    final gate = Completer<http.Response>();
    final hub = FakeHub()..on('/api/devices', () => gate.future);

    await pumpApp(tester, hub);
    await tester.pump();

    expect(find.text('Thiết bị'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('W-W603 2'), findsNothing);

    gate.complete(jsonResponse(devicesBody()));
    await tester.pumpAndSettle();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(hub.requests, ['/api/devices']);
  });

  testWidgets('lists each device with name, type, protocol and online state', (tester) async {
    final hub = FakeHub()..respond('/api/devices', devicesBody());

    await pumpApp(tester, hub);
    await tester.pumpAndSettle();

    expect(find.text('W-W603 2'), findsOneWidget);
    expect(find.text('kg · tuya'), findsOneWidget);
    expect(find.text('Trực tuyến'), findsOneWidget);

    expect(find.text('Đèn phòng khách'), findsOneWidget);
    expect(find.text('light · matter'), findsOneWidget);
    expect(find.text('Ngoại tuyến'), findsOneWidget);

    // The device whose lookup failed is still listed, by its native id.
    expect(find.text('broken'), findsOneWidget);
    expect(find.text('Không lấy được thông tin thiết bị · tuya'), findsOneWidget);
    expect(find.text('Không rõ'), findsOneWidget);
  });

  testWidgets('shows an empty state when the Hub has no devices', (tester) async {
    final hub = FakeHub()..respond('/api/devices', {'devices': <Object>[]});

    await pumpApp(tester, hub);
    await tester.pumpAndSettle();

    expect(find.text('Hub chưa có thiết bị nào'), findsOneWidget);
    expect(find.text('Tải lại'), findsWidgets);
  });

  testWidgets('shows a clear error with retry when the Hub is unreachable', (tester) async {
    final hub = FakeHub()..failNetwork('/api/devices');

    await pumpApp(tester, hub);
    await tester.pumpAndSettle();

    expect(find.text('Không kết nối được với Hub'), findsOneWidget);
    expect(find.textContaining('http://hub.test:3000'), findsWidgets);
    expect(find.text('Thử lại'), findsOneWidget);
    expect(find.text('W-W603 2'), findsNothing);
  });

  testWidgets('retry loads the devices once the Hub is back', (tester) async {
    final hub = FakeHub()..failNetwork('/api/devices');

    await pumpApp(tester, hub);
    await tester.pumpAndSettle();
    expect(find.text('Thử lại'), findsOneWidget);

    hub.respond('/api/devices', devicesBody());
    await tester.tap(find.text('Thử lại'));
    await tester.pumpAndSettle();

    expect(find.text('Thử lại'), findsNothing);
    expect(find.text('W-W603 2'), findsOneWidget);
    expect(hub.requests, ['/api/devices', '/api/devices']);
  });

  testWidgets('explains a Hub error using the Hub\'s own error code', (tester) async {
    final hub = FakeHub()
      ..respond('/api/devices', {'error': 'Upstream is down', 'code': 'UPSTREAM_ERROR'}, 502);

    await pumpApp(tester, hub);
    await tester.pumpAndSettle();

    expect(find.text('Dịch vụ thiết bị không phản hồi'), findsOneWidget);
    expect(find.text('Thử lại'), findsOneWidget);
  });

  testWidgets('the refresh button reloads the list', (tester) async {
    final hub = FakeHub()..respond('/api/devices', devicesBody());

    await pumpApp(tester, hub);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Tải lại'));
    await tester.pumpAndSettle();

    expect(hub.requests, ['/api/devices', '/api/devices']);
    expect(find.text('W-W603 2'), findsOneWidget);
  });

  testWidgets('tapping a device opens its detail with capabilities', (tester) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final hub = FakeHub()
      ..respond('/api/devices', devicesBody())
      ..respond('/api/devices/$switchDeviceId/capabilities', switchCapabilitiesBody())
      ..respond('/api/devices/$switchDeviceId/status', {
        'id': switchDeviceId,
        'status': [
          {'code': 'switch_1', 'value': false},
        ],
      });

    await pumpApp(tester, hub);
    await tester.pumpAndSettle();
    await tester.tap(find.text('W-W603 2'));
    await tester.pumpAndSettle();

    // Basic facts from the list entry.
    expect(find.text('Mã thiết bị'), findsOneWidget);
    expect(find.text(switchDeviceId), findsOneWidget);
    expect(find.text('Giao thức / nguồn'), findsOneWidget);
    expect(find.text('tuya'), findsOneWidget);
    expect(find.text('kg'), findsOneWidget);
    expect(find.text('Trực tuyến'), findsOneWidget);

    // Capabilities (and, since Sprint 2, the status behind the controls) are
    // fetched for this device only.
    expect(hub.requests, [
      '/api/devices',
      '/api/devices/$switchDeviceId/capabilities',
      '/api/devices/$switchDeviceId/status',
    ]);
    expect(find.text('Lệnh thiết bị hỗ trợ'), findsOneWidget);
    expect(find.text('countdown_1'), findsOneWidget);
    expect(find.text('Integer · 0–86400 s'), findsOneWidget);
    expect(find.text('Chế độ'), findsOneWidget);
    expect(find.text('mode · Enum · cold / hot'), findsOneWidget);
    expect(find.text('Trạng thái thiết bị báo về'), findsOneWidget);

    // Sprint 2: the Boolean command `switch_1` gets a switch (Sprint 1 had no
    // controls); the Integer and Enum commands still do not.
    expect(find.byType(Switch), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Thiết bị'), findsOneWidget);
  });
}
