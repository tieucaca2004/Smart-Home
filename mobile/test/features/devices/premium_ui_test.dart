import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:tieu_home/app.dart';
import 'package:tieu_home/core/theme/app_theme.dart';
import 'package:tieu_home/features/devices/device_detail_screen.dart';
import 'package:tieu_home/features/devices/device_kind.dart';
import 'package:tieu_home/features/devices/device_list_screen.dart';
import 'package:tieu_home/features/devices/device_summary.dart';
import 'package:tieu_home/features/devices/widgets/dashboard_header.dart';
import 'package:tieu_home/features/devices/widgets/device_card.dart';
import 'package:tieu_home/models/device.dart';

import '../../support/fake_hub.dart';
import '../../support/fixtures.dart';
import '../../support/ui_helpers.dart';

// Sprint 4: what the redesigned screens promise a person. These tests look at
// what is on screen (order, presence, size, state), not at how many Text
// widgets a layout happens to use, and they touch no Hub behavior: that is
// covered by the Sprint 2/3/3A tests, which are unchanged.
//
// The test font draws every letter as a square, wider than a real font, so a
// layout that fits here fits on a phone.

const String capabilitiesPath = '/api/devices/$realDeviceId/capabilities';

const Device realDevice = Device(
  id: realDeviceId,
  nativeId: '1638018234ab950e1ecd',
  protocol: 'tuya',
  name: 'W-W603 2',
  category: 'kg',
  online: true,
);

const Device offlineDevice = Device(
  id: realDeviceId,
  nativeId: '1638018234ab950e1ecd',
  protocol: 'tuya',
  name: 'W-W603 2',
  category: 'kg',
  online: false,
);

Map<String, Object?> entry(String id, {String? name, String? category, bool? online}) => {
      'id': id,
      'nativeId': id.substring(id.indexOf(':') + 1),
      'protocol': 'tuya',
      'name': ?name,
      'category': ?category,
      'online': ?online,
    };

FakeHub hubWith(List<Map<String, Object?>> devices) =>
    FakeHub()..respond('/api/devices', {'devices': devices});

/// A Hub serving [realDevice]: three switches and their timers, all off.
FakeHub realDeviceHub() {
  final hub = FakeHub()..respond(capabilitiesPath, realDeviceCapabilitiesBody());
  hub.serveDevice(realDeviceId, {'switch_1': false, 'switch_2': false, 'switch_3': false});
  return hub;
}

/// Shows [app] on a screen of [size] logical pixels, with text scaled by [textScale].
Future<void> pumpAt(
  WidgetTester tester,
  Widget app, {
  Size size = const Size(800, 1800),
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(() {
    tester.view.reset();
    tester.platformDispatcher.clearTextScaleFactorTestValue();
  });
  await tester.pumpWidget(app);
  await tester.pumpAndSettle();
}

Widget detailApp(FakeHub hub, {Device device = realDevice}) => MaterialApp(
      theme: AppTheme.light(),
      home: DeviceDetailScreen(device: device, client: hub.apiClient()),
    );

Finder toggle(String code) => find.byKey(ValueKey('toggle-$code'));
Finder tile(String code) => find.byKey(ValueKey('control-$code'));

void main() {
  group('home: dashboard header and summary', () {
    testWidgets('the summary counts every device, online and offline', (tester) async {
      final hub = hubWith([
        entry('tuya:a', name: 'A', category: 'kg', online: true),
        entry('tuya:b', name: 'B', category: 'dj', online: true),
        entry('tuya:c', name: 'C', category: 'fs', online: false),
        entry('tuya:d', name: 'D'),
      ]);

      await pumpAt(tester, TieuHomeApp(client: hub.apiClient()));

      // Four devices: two online, one offline, one the Hub did not say.
      expect(find.text('4'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
      expect(find.text('thiết bị'), findsOneWidget);
      expect(find.text('trực tuyến'), findsOneWidget);
      expect(find.text('ngoại tuyến'), findsOneWidget);
      // The offline one and the unknown one both need a look.
      expect(find.text('2 thiết bị cần chú ý'), findsOneWidget);
    });

    testWidgets('when every device is online the header says so', (tester) async {
      final hub = hubWith([
        entry('tuya:a', name: 'A', online: true),
        entry('tuya:b', name: 'B', online: true),
      ]);

      await pumpAt(tester, TieuHomeApp(client: hub.apiClient()));

      expect(find.text('Mọi thiết bị đều đang trực tuyến'), findsOneWidget);
    });

    testWidgets('the screen opens with a greeting and the app name, above the devices', (tester) async {
      final hub = hubWith([entry('tuya:a', name: 'Đèn ngủ', category: 'dj', online: true)]);

      await pumpAt(tester, TieuHomeApp(client: hub.apiClient()));

      final greeting = tester.getTopLeft(find.text(greetingFor(DateTime.now()))).dy;
      final title = tester.getTopLeft(find.text('Tiểu Home')).dy;
      final heading = tester.getTopLeft(find.text('Thiết bị')).dy;
      final card = tester.getTopLeft(find.byType(DeviceCard)).dy;
      expect(greeting, lessThan(title));
      expect(title, lessThan(heading));
      expect(heading, lessThan(card));
    });

    testWidgets('DeviceSummaryRow shows the three numbers it is given', (tester) async {
      await pumpAt(
        tester,
        MaterialApp(
          theme: AppTheme.light(),
          home: const Scaffold(
            body: Padding(
              padding: EdgeInsets.all(20),
              child: DeviceSummaryRow(
                DeviceSummary(total: 12, online: 9, offline: 3, unknown: 0),
              ),
            ),
          ),
        ),
        size: const Size(800, 600),
      );

      for (final text in ['12', '9', '3', 'thiết bị', 'trực tuyến', 'ngoại tuyến']) {
        expect(find.text(text), findsOneWidget, reason: text);
      }
    });

    testWidgets('while loading, the message says what is loading', (tester) async {
      final gate = Completer<http.Response>();
      final hub = FakeHub()..on('/api/devices', () => gate.future);

      tester.view.physicalSize = const Size(800, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(TieuHomeApp(client: hub.apiClient()));
      await tester.pump();

      expect(find.text('Đang tải thiết bị…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      // The header is already there: the screen does not jump when the list arrives.
      expect(find.text('Tiểu Home'), findsOneWidget);
      // There is nothing to summarise yet.
      expect(find.text('trực tuyến'), findsNothing);

      gate.complete(jsonResponse({'devices': <Object>[]}));
      await tester.pumpAndSettle();
    });
  });

  group('home: device cards', () {
    testWidgets('each kind of device gets its own icon; an unknown one gets the generic icon', (tester) async {
      final hub = hubWith([
        entry('tuya:a', name: 'A', category: 'kg'),
        entry('tuya:b', name: 'B', category: 'dj'),
        entry('tuya:c', name: 'C', category: 'fs'),
        entry('tuya:d', name: 'D', category: 'zzz'),
        entry('tuya:e', name: 'Tủ lạnh nhà bếp'),
      ]);

      await pumpAt(tester, TieuHomeApp(client: hub.apiClient()));

      for (final kind in [
        DeviceKind.switchGear,
        DeviceKind.light,
        DeviceKind.fan,
        DeviceKind.generic,
        DeviceKind.fridge,
      ]) {
        expect(find.byIcon(kind.icon), findsOneWidget, reason: kind.name);
      }
      // The type is also written out, in Vietnamese.
      for (final label in ['Công tắc', 'Đèn', 'Quạt', 'Thiết bị khác', 'Tủ lạnh']) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
    });

    testWidgets('a glance reads icon, then name, then status, then type', (tester) async {
      final hub = hubWith([entry('tuya:a', name: 'Đèn ngủ', category: 'dj', online: true)]);

      await pumpAt(tester, TieuHomeApp(client: hub.apiClient()));

      final icon = tester.getTopLeft(find.byIcon(DeviceKind.light.icon));
      final name = tester.getTopLeft(find.text('Đèn ngủ'));
      final status = tester.getTopLeft(find.text('Trực tuyến'));
      final type = tester.getTopLeft(find.text('Đèn'));
      expect(icon.dx, lessThan(name.dx), reason: 'icon before name');
      expect(name.dy, lessThan(status.dy), reason: 'name above status');
      expect(status.dx, lessThan(type.dx), reason: 'status before type');
    });

    testWidgets('a card is compact', (tester) async {
      final hub = hubWith([entry('tuya:a', name: 'Đèn ngủ', category: 'dj', online: true)]);

      await pumpAt(tester, TieuHomeApp(client: hub.apiClient()));

      expect(tester.getSize(find.byType(DeviceCard)).height, lessThan(110));
    });

    testWidgets('an offline device is visually quieter than an online one', (tester) async {
      final hub = hubWith([
        entry('tuya:a', name: 'Đèn phòng khách', category: 'dj', online: true),
        entry('tuya:b', name: 'Đèn ban công', category: 'dj', online: false),
      ]);

      await pumpAt(tester, TieuHomeApp(client: hub.apiClient()));

      final scheme = Theme.of(tester.element(find.byType(Scaffold))).colorScheme;
      Color? nameColor(String name) => tester.widget<Text>(find.text(name)).style?.color;
      expect(nameColor('Đèn phòng khách'), scheme.onSurface);
      expect(nameColor('Đèn ban công'), scheme.onSurfaceVariant);
      // Still listed, still readable and still openable.
      expect(find.text('Ngoại tuyến'), findsOneWidget);
      expect(find.byType(DeviceCard), findsNWidgets(2));
    });

    testWidgets('the home screen also renders in the dark theme', (tester) async {
      final hub = hubWith([
        entry('tuya:a', name: 'Đèn phòng khách', category: 'dj', online: true),
        entry('tuya:b', name: 'Quạt trần', category: 'fs', online: false),
      ]);

      await pumpAt(
        tester,
        MaterialApp(theme: AppTheme.dark(), home: DeviceListScreen(client: hub.apiClient())),
      );

      expect(Theme.of(tester.element(find.byType(Scaffold))).brightness, Brightness.dark);
      expect(find.byType(DeviceCard), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    });
  });

  group('detail: controls first, technical details folded', () {
    testWidgets('the technical card starts folded and opens and closes on tap', (tester) async {
      final hub = realDeviceHub();

      await pumpAt(tester, detailApp(hub));

      expect(find.text('Thông tin kỹ thuật'), findsOneWidget);
      expect(find.text('Mã thiết bị'), findsNothing);
      expect(find.text(realDeviceId), findsNothing);
      // The controls are on screen without opening anything.
      expect(find.byType(Switch), findsNWidgets(3));

      final requestsBefore = List<String>.of(hub.calls);
      await expandTechnicalInfo(tester);

      expect(find.text('Mã thiết bị'), findsOneWidget);
      expect(find.text(realDeviceId), findsOneWidget);
      expect(find.text('Lệnh thiết bị hỗ trợ'), findsOneWidget);
      // Opening it is only presentation: nothing is requested.
      expect(hub.calls, requestsBefore);

      await expandTechnicalInfo(tester);

      expect(find.text('Mã thiết bị'), findsNothing);
    });

    testWidgets('the technical card is the last thing on the screen', (tester) async {
      final hub = realDeviceHub();

      await pumpAt(tester, detailApp(hub));

      final technical = tester.getTopLeft(find.text('Thông tin kỹ thuật')).dy;
      for (final code in ['switch_1', 'switch_2', 'switch_3']) {
        expect(tester.getBottomLeft(tile(code)).dy, lessThan(technical), reason: code);
      }
    });

    testWidgets('while the capabilities load, the controls area says so instead of staying blank', (tester) async {
      final gate = Completer<http.Response>();
      final hub = FakeHub()..on(capabilitiesPath, () => gate.future);
      hub.serveDevice(realDeviceId, {'switch_1': false, 'switch_2': false, 'switch_3': false});

      tester.view.physicalSize = const Size(800, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(detailApp(hub));
      await tester.pump();

      expect(find.text('Đang tải điều khiển…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Điều khiển'), findsNothing);

      gate.complete(jsonResponse(realDeviceCapabilitiesBody()));
      await tester.pumpAndSettle();

      expect(find.text('Đang tải điều khiển…'), findsNothing);
      expect(find.text('Điều khiển'), findsOneWidget);
    });

    testWidgets('a capabilities failure is visible without opening the technical card', (tester) async {
      final hub = FakeHub()..failNetwork(capabilitiesPath);

      await pumpAt(tester, detailApp(hub));

      expect(find.text('Không kết nối được với Hub'), findsOneWidget);
      expect(find.text('Thử lại'), findsOneWidget);
      // The technical card does not repeat the error or offer a second retry.
      await expandTechnicalInfo(tester);
      expect(find.text('Thử lại'), findsOneWidget);
    });

    testWidgets('a device with nothing to switch says so, instead of an empty screen', (tester) async {
      final hub = FakeHub()
        ..respond(
          capabilitiesPath,
          capabilitiesBody(
            realDeviceId,
            commands: [
              {'code': 'level', 'type': 'Integer', 'values': <String, Object?>{}},
            ],
          ),
        );

      await pumpAt(tester, detailApp(hub));

      expect(find.text('Thiết bị này chưa có điều khiển bật/tắt trong ứng dụng.'), findsOneWidget);
      expect(find.text('Điều khiển'), findsNothing);
      expect(find.byType(Switch), findsNothing);
    });

    testWidgets('a device with no controls but real statuses says the app still hears from it', (tester) async {
      final hub = FakeHub()
        ..respond(capabilitiesPath, {
          'id': realDeviceId,
          'capabilities': {
            'id': realDeviceId,
            'protocol': 'tuya',
            'nativeId': '1638018234ab950e1ecd',
            'name': 'W-W603 2',
            'online': true,
            'commands': <Object>[],
            'statuses': [
              {'code': 'va_temperature', 'type': 'Integer', 'name': 'Nhiệt độ', 'values': <String, Object?>{}},
              {'code': 'va_humidity', 'type': 'Integer', 'name': 'Độ ẩm', 'values': <String, Object?>{}},
            ],
          },
        });

      await pumpAt(tester, detailApp(hub));

      // The fixed headline stays exactly as before (pinned test contract).
      expect(find.text('Thiết bị này chưa có điều khiển bật/tắt trong ứng dụng.'), findsOneWidget);
      // A short second line, built only from the already-loaded capabilities
      // (no extra request — see hub.requests below), names what it does report.
      expect(
        find.text('Ứng dụng vẫn nhận được thông tin từ thiết bị: Nhiệt độ, Độ ẩm.'),
        findsOneWidget,
      );
      expect(hub.requests, [capabilitiesPath]);
    });

    testWidgets('a device with no controls and no statuses at all shows only the fixed headline', (tester) async {
      final hub = FakeHub()
        ..respond(capabilitiesPath, {
          'id': realDeviceId,
          'capabilities': {
            'id': realDeviceId,
            'protocol': 'tuya',
            'nativeId': '1638018234ab950e1ecd',
            'name': 'W-W603 2',
            'online': true,
            'commands': <Object>[],
            'statuses': <Object>[],
          },
        });

      await pumpAt(tester, detailApp(hub));

      expect(find.text('Thiết bị này chưa có điều khiển bật/tắt trong ứng dụng.'), findsOneWidget);
      expect(find.textContaining('Ứng dụng vẫn nhận được'), findsNothing);
    });

    testWidgets('the header shows the icon and the type of the device, not its raw category', (tester) async {
      final hub = realDeviceHub();

      await pumpAt(tester, detailApp(hub));

      expect(find.byIcon(DeviceKind.switchGear.icon), findsOneWidget);
      expect(find.text('Công tắc'), findsOneWidget);
      expect(find.text('kg'), findsNothing);
    });

    testWidgets('the switches are enlarged, easy to hit', (tester) async {
      final hub = realDeviceHub();

      await pumpAt(tester, detailApp(hub));

      final scales = tester
          .widgetList<Transform>(find.ancestor(of: toggle('switch_1'), matching: find.byType(Transform)))
          .map((t) => t.transform.getMaxScaleOnAxis());
      expect(scales.any((scale) => scale > 1.05), isTrue);
      expect(tester.getSize(toggle('switch_1')).height, greaterThanOrEqualTo(32));
    });
  });

  group('responsive: no overflow on small phones or with large text', () {
    // Logical size of the screen and the system text scale.
    final screens = <(Size, double)>[
      (const Size(320, 568), 1),
      (const Size(360, 640), 1.3),
      (const Size(320, 568), 1.5),
      (const Size(411, 891), 1),
      (const Size(600, 960), 1),
    ];

    for (final (size, scale) in screens) {
      final label = '${size.width.toInt()}x${size.height.toInt()}, text x$scale';

      testWidgets('home screen with many devices and long names: $label', (tester) async {
        const categories = ['kg', 'dj', 'fs', 'cz', 'mcs', 'bx', 'zzz'];
        final hub = hubWith([
          for (var i = 1; i <= 12; i++)
            entry(
              'tuya:dev-$i',
              name: 'Thiết bị có cái tên rất dài số $i để thử cắt chữ',
              category: categories[i % categories.length],
              online: i % 4 == 0 ? false : (i % 5 == 0 ? null : true),
            ),
          entry('tuya:broken'),
        ]);

        await pumpAt(tester, TieuHomeApp(client: hub.apiClient()), size: size, textScale: scale);

        expect(tester.takeException(), isNull);
        expect(tester.getRect(find.byType(DeviceCard).first).right, lessThanOrEqualTo(size.width));

        // Down to the last card.
        await tester.drag(find.byType(ListView), Offset(0, -size.height * 8));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.text('broken'), findsOneWidget);
      });

      testWidgets('device screen with controls and technical details: $label', (tester) async {
        final hub = realDeviceHub();

        await pumpAt(tester, detailApp(hub), size: size, textScale: scale);
        // On a small screen with large text the card is below the fold (and
        // not built yet): scroll to it, then open it.
        await tester.scrollUntilVisible(
          find.text('Thông tin kỹ thuật'),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pumpAndSettle();
        await expandTechnicalInfo(tester);

        expect(tester.takeException(), isNull);
        for (final code in ['switch_1', 'switch_2', 'switch_3']) {
          final rect = tester.getRect(tile(code));
          expect(rect.left, greaterThanOrEqualTo(0), reason: code);
          expect(rect.right, lessThanOrEqualTo(size.width), reason: code);
        }

        await tester.drag(find.byType(ListView), Offset(0, -size.height * 8));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('an offline device and an error state fit a small screen too', (tester) async {
      final hub = FakeHub()
        ..respond(capabilitiesPath, realDeviceCapabilitiesBody(online: false))
        ..failNetwork('/api/devices');

      await pumpAt(tester, TieuHomeApp(client: hub.apiClient()), size: const Size(320, 568), textScale: 1.5);
      expect(find.text('Không kết nối được với Hub'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await pumpAt(
        tester,
        detailApp(hub, device: offlineDevice),
        size: const Size(320, 568),
        textScale: 1.5,
      );
      expect(find.byType(Switch), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });
}
