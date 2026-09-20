import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/app.dart';
import 'package:tieu_home/features/devices/control_messages.dart';
import 'package:tieu_home/features/devices/device_detail_screen.dart';
import 'package:tieu_home/features/devices/device_name_store.dart';
import 'package:tieu_home/models/device.dart';

import '../../support/fake_hub.dart';
import '../../support/fixtures.dart';
import '../../support/ui_helpers.dart';

// Sprint 3: what a person sees on the screens. The Hub here answers the way
// the real one does for the W-W603 2: Chinese names (开关1 ...) next to the
// codes (switch_1 ...).

const String capabilitiesPath = '/api/devices/$realDeviceId/capabilities';
const String statusPath = '/api/devices/$realDeviceId/status';
const String commandsPath = '/api/devices/$realDeviceId/commands';

const Device realDevice = Device(
  id: realDeviceId,
  nativeId: '1638018234ab950e1ecd',
  protocol: 'tuya',
  name: 'W-W603 2',
  category: 'kg',
  online: true,
);

final RegExp han = RegExp('[⺀-鿿]');

Finder toggle(String code) => find.byKey(ValueKey('toggle-$code'));
Finder tile(String code) => find.byKey(ValueKey('control-$code'));
Finder inTile(String code, String text) =>
    find.descendant(of: tile(code), matching: find.text(text));
Finder spinnerIn(String code) =>
    find.descendant(of: tile(code), matching: find.byType(CircularProgressIndicator));

bool isOn(WidgetTester tester, String code) => tester.widget<Switch>(toggle(code)).value;

/// Every string drawn with a [Text] widget on screen.
List<String> shownTexts(WidgetTester tester) {
  return [
    for (final text in tester.widgetList<Text>(find.byType(Text)))
      text.data ?? text.textSpan?.toPlainText() ?? '',
  ];
}

const Map<String, Object?> _countdownValues = {
  'min': 0,
  'max': 86400,
  'scale': 0,
  'step': 1,
  'unit': 's',
};

/// Capabilities as the Hub relays them from the vendor: Chinese `name`s.
/// [switches] are the numbers of the switch_N commands the device has.
Map<String, Object?> chineseCapabilities({
  List<int> switches = const [1, 2, 3],
  bool? online = true,
}) {
  return capabilitiesBody(
    realDeviceId,
    name: 'W-W603 2',
    online: online,
    commands: [
      for (final n in switches)
        {'code': 'switch_$n', 'name': '开关$n', 'type': 'Boolean', 'values': <String, Object?>{}},
      for (final n in switches)
        {'code': 'countdown_$n', 'name': '倒计时$n', 'type': 'Integer', 'values': _countdownValues},
    ],
  );
}

(FakeHub, FakeControllableDevice) hubServing(
  Map<String, Object?> capabilities, {
  Map<String, Object?>? state,
}) {
  final hub = FakeHub()..respond(capabilitiesPath, capabilities);
  final device = hub.serveDevice(
    realDeviceId,
    state ?? {'switch_1': false, 'switch_2': false, 'switch_3': false},
  );
  return (hub, device);
}

void tallScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> pumpDetail(
  WidgetTester tester,
  FakeHub hub, {
  Device device = realDevice,
  DeviceNameStore? nameStore,
}) async {
  tallScreen(tester);
  await tester.pumpWidget(
    MaterialApp(
      home: DeviceDetailScreen(device: device, client: hub.apiClient(), nameStore: nameStore),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('control labels', () {
    testWidgets('Chinese labels are shown as Công tắc 1 / 2 / 3, never as Chinese', (tester) async {
      final (hub, _) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub);

      expect(inTile('switch_1', 'Công tắc 1'), findsOneWidget);
      expect(inTile('switch_2', 'Công tắc 2'), findsOneWidget);
      expect(inTile('switch_3', 'Công tắc 3'), findsOneWidget);
      expect(find.text('开关1'), findsNothing);
      expect(find.text('开关2'), findsNothing);
      expect(find.text('开关3'), findsNothing);
      // Nothing anywhere on the screen (technical section included) is Chinese.
      expect(shownTexts(tester).where(han.hasMatch), isEmpty);
    });

    testWidgets('the raw code and type stay, as secondary text under the label', (tester) async {
      final (hub, _) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub);

      for (final n in [1, 2, 3]) {
        expect(inTile('switch_$n', 'switch_$n · Boolean'), findsOneWidget, reason: 'switch_$n');
      }
      // The code is not the main label of any control.
      expect(inTile('switch_1', 'switch_1'), findsNothing);
      final label = tester.getTopLeft(inTile('switch_1', 'Công tắc 1'));
      final technical = tester.getTopLeft(inTile('switch_1', 'switch_1 · Boolean'));
      expect(technical.dy, greaterThan(label.dy));
      final labelStyle = tester.widget<Text>(inTile('switch_1', 'Công tắc 1')).style;
      final technicalStyle = tester.widget<Text>(inTile('switch_1', 'switch_1 · Boolean')).style;
      expect(technicalStyle!.fontSize!, lessThan(labelStyle!.fontSize!));
    });

    testWidgets('the technical section lists each function with its code beneath the friendly label',
        (tester) async {
      final (hub, _) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub);
      await expandTechnicalInfo(tester);

      expect(find.text('Thông tin kỹ thuật'), findsOneWidget);
      // Commands and statuses both list the timers, with code, type and limits.
      expect(find.text('Đếm ngược 1'), findsNWidgets(2));
      expect(find.text('countdown_1 · Integer · 0–86400 s'), findsNWidgets(2));
      // The switches are listed there too (commands and statuses), plus once as a control.
      expect(find.text('Công tắc 1'), findsNWidgets(3));
    });

    testWidgets('no name from the Hub: the switch_N rule gives the label', (tester) async {
      final (hub, _) = hubServing(realDeviceCapabilitiesBody());

      await pumpDetail(tester, hub);

      expect(inTile('switch_1', 'Công tắc 1'), findsOneWidget);
      expect(inTile('switch_2', 'Công tắc 2'), findsOneWidget);
      expect(inTile('switch_3', 'Công tắc 3'), findsOneWidget);
    });

    // The number of switches is whatever the device lists, not a fixed three.
    for (final switches in [
      [1],
      [1, 2],
      [1, 2, 3, 4, 5, 6],
    ]) {
      testWidgets('a device with ${switches.length} switch(es) gets exactly that many controls',
          (tester) async {
        final (hub, _) = hubServing(
          chineseCapabilities(switches: switches),
          state: {for (final n in switches) 'switch_$n': false},
        );

        await pumpDetail(tester, hub);

        expect(find.byType(Switch), findsNWidgets(switches.length));
        for (final n in switches) {
          expect(inTile('switch_$n', 'Công tắc $n'), findsOneWidget, reason: 'switch_$n');
        }
        expect(tile('switch_${switches.length + 1}'), findsNothing);
      });
    }

    testWidgets('an unknown Chinese label on an unknown code is not shown either', (tester) async {
      const id = 'zigbee:sensor-1';
      final hub = FakeHub()
        ..respond(
          '/api/devices/$id/capabilities',
          capabilitiesBody(
            id,
            protocol: 'zigbee',
            commands: [
              {'code': 'child_lock', 'name': '童锁', 'type': 'Boolean', 'values': <String, Object?>{}},
            ],
          ),
        );
      hub.serveDevice(id, {'child_lock': false});

      await pumpDetail(
        tester,
        hub,
        device: const Device(id: id, nativeId: 'sensor-1', protocol: 'zigbee', name: 'Cảm biến'),
      );

      expect(inTile('child_lock', 'Child lock'), findsOneWidget);
      expect(inTile('child_lock', 'child_lock · Boolean'), findsOneWidget);
      expect(shownTexts(tester).where(han.hasMatch), isEmpty);
    });
  });

  group('screen hierarchy', () {
    testWidgets('name and status first, then the controls, then the technical details', (tester) async {
      final (hub, _) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub);

      final name = tester.getTopLeft(find.text('W-W603 2')).dy;
      final status = tester.getTopLeft(find.text('Trực tuyến')).dy;
      final controls = tester.getTopLeft(find.text('Điều khiển')).dy;
      final technical = tester.getTopLeft(find.text('Thông tin kỹ thuật')).dy;
      expect(name, lessThan(status));
      expect(status, lessThan(controls));
      expect(controls, lessThan(technical));
      // The controls all sit between "Điều khiển" and "Thông tin kỹ thuật".
      for (final code in ['switch_1', 'switch_2', 'switch_3']) {
        final y = tester.getTopLeft(tile(code)).dy;
        expect(y, greaterThan(controls), reason: code);
        expect(y, lessThan(technical), reason: code);
      }
    });

    testWidgets('the device id and other technical facts are in the technical section', (tester) async {
      final (hub, _) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub);
      await expandTechnicalInfo(tester);

      final technical = tester.getTopLeft(find.text('Thông tin kỹ thuật')).dy;
      for (final text in [realDeviceId, 'tuya', 'kg', '1638018234ab950e1ecd']) {
        expect(tester.getTopLeft(find.text(text)).dy, greaterThan(technical), reason: text);
      }
    });
  });

  group('online status', () {
    testWidgets('online device: "Trực tuyến" once, with working switches', (tester) async {
      final (hub, _) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub);

      expect(find.text('Trực tuyến'), findsOneWidget);
      expect(find.text('Ngoại tuyến'), findsNothing);
      expect(find.byType(Switch), findsNWidgets(3));
    });

    testWidgets('offline device: "Ngoại tuyến" once, no switches, nothing sent', (tester) async {
      final (hub, device) = hubServing(chineseCapabilities(online: false));

      await pumpDetail(tester, hub, device: const Device(
        id: realDeviceId,
        nativeId: '1638018234ab950e1ecd',
        protocol: 'tuya',
        name: 'W-W603 2',
        category: 'kg',
        online: false,
      ));

      expect(find.text('Ngoại tuyến'), findsOneWidget);
      expect(find.text('Trực tuyến'), findsNothing);
      expect(find.text(offlineDeviceNotice), findsOneWidget);
      expect(find.byType(Switch), findsNothing);
      // The labels are still friendly, and each control says why it is idle.
      expect(inTile('switch_1', 'Công tắc 1'), findsOneWidget);
      expect(inTile('switch_1', 'Thiết bị ngoại tuyến'), findsOneWidget);
      expect(hub.posts, isEmpty);
      expect(device.commands, isEmpty);
    });

    testWidgets('the Hub does not say: "Không rõ"', (tester) async {
      final (hub, _) = hubServing(chineseCapabilities(online: null));

      await pumpDetail(
        tester,
        hub,
        device: const Device(
          id: realDeviceId,
          nativeId: '1638018234ab950e1ecd',
          protocol: 'tuya',
          name: 'W-W603 2',
        ),
      );

      expect(find.text('Không rõ'), findsOneWidget);
    });
  });

  group('control state and command flow (Sprint 2 behavior, new labels)', () {
    testWidgets('each control shows the state the device reports', (tester) async {
      final (hub, _) = hubServing(
        chineseCapabilities(),
        state: {'switch_1': true, 'switch_2': false, 'switch_3': true},
      );

      await pumpDetail(tester, hub);

      expect(isOn(tester, 'switch_1'), isTrue);
      expect(isOn(tester, 'switch_2'), isFalse);
      expect(isOn(tester, 'switch_3'), isTrue);
      expect(inTile('switch_1', 'Đang bật'), findsOneWidget);
      expect(inTile('switch_2', 'Đang tắt'), findsOneWidget);
      expect(inTile('switch_3', 'Đang bật'), findsOneWidget);
      expect(hub.calls, ['GET $capabilitiesPath', 'GET $statusPath']);
    });

    testWidgets('a tap sends the Hub command, reads the status back and shows the confirmed state',
        (tester) async {
      final (hub, device) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub);
      hub.calls.clear();

      await tester.tap(toggle('switch_2'));
      await tester.pumpAndSettle();

      expect(device.commands, [
        {'code': 'switch_2', 'value': true},
      ]);
      expect(hub.calls, ['POST $commandsPath', 'GET $statusPath']);
      expect(isOn(tester, 'switch_2'), isTrue);
      expect(isOn(tester, 'switch_1'), isFalse);
      expect(inTile('switch_2', 'Đang bật'), findsOneWidget);
      expect(find.text('Thiết bị đã xác nhận.'), findsOneWidget);
    });

    testWidgets('while one control is pending only that one is locked, and its label stays',
        (tester) async {
      final (hub, device) = hubServing(chineseCapabilities());
      final gate = Completer<void>();
      device.gate = gate;

      await pumpDetail(tester, hub);

      await tester.tap(toggle('switch_1'));
      await tester.pump();

      expect(spinnerIn('switch_1'), findsOneWidget);
      expect(toggle('switch_1'), findsNothing);
      expect(inTile('switch_1', 'Công tắc 1'), findsOneWidget);
      expect(inTile('switch_1', 'Đang gửi lệnh…'), findsOneWidget);
      // The rest of the screen is not blocked.
      expect(tester.widget<Switch>(toggle('switch_2')).onChanged, isNotNull);
      expect(tester.widget<Switch>(toggle('switch_3')).onChanged, isNotNull);

      gate.complete();
      await tester.pumpAndSettle();

      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(isOn(tester, 'switch_1'), isTrue);
    });

    testWidgets('a rejected command shows the error and no success', (tester) async {
      final (hub, device) = hubServing(chineseCapabilities());
      device.online = false;

      await pumpDetail(tester, hub);

      await tester.tap(toggle('switch_3'));
      await tester.pumpAndSettle();

      expect(find.text('Thiết bị đang ngoại tuyến nên chưa nhận được lệnh.'), findsOneWidget);
      expect(find.text('Thiết bị đã xác nhận.'), findsNothing);
      expect(isOn(tester, 'switch_3'), isFalse);
      expect(inTile('switch_3', 'Đang tắt'), findsOneWidget);
    });

    testWidgets('a command the device ignores is flagged, and the switch keeps the reported state',
        (tester) async {
      final (hub, device) = hubServing(chineseCapabilities());
      device.applyCommands = false;

      await pumpDetail(tester, hub);

      await tester.tap(toggle('switch_1'));
      await tester.pumpAndSettle();

      expect(find.textContaining('thiết bị chưa báo trạng thái mới'), findsOneWidget);
      expect(find.text('Thiết bị đã xác nhận.'), findsNothing);
      expect(isOn(tester, 'switch_1'), isFalse);
    });
  });

  group('device name', () {
    testWidgets('by default the name the Hub reports is shown', (tester) async {
      final (hub, _) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub);

      expect(find.text('W-W603 2'), findsOneWidget);
      expect(find.textContaining('Tên gốc'), findsNothing);
    });

    testWidgets('a custom name replaces it in the list and on the detail screen; the id is untouched',
        (tester) async {
      tallScreen(tester);
      final store = InMemoryDeviceNameStore();
      await store.setCustomName(realDeviceId, 'Công tắc phòng khách');
      final (hub, device) = hubServing(chineseCapabilities());
      hub.respond('/api/devices', devicesBody());

      await tester.pumpWidget(TieuHomeApp(client: hub.apiClient(), nameStore: store));
      await tester.pumpAndSettle();

      // List: the custom name for that device, the Hub's name for the others.
      expect(find.text('Công tắc phòng khách'), findsOneWidget);
      expect(find.text('W-W603 2'), findsNothing);
      expect(find.text('Đèn phòng khách'), findsOneWidget);

      await tester.tap(find.text('Công tắc phòng khách'));
      await tester.pumpAndSettle();
      await expandTechnicalInfo(tester);

      // Detail: custom name as the title, the original name kept visible.
      expect(find.text('Công tắc phòng khách'), findsOneWidget);
      expect(find.text('Tên gốc: W-W603 2'), findsOneWidget);
      expect(find.text(realDeviceId), findsOneWidget);

      // Every request still uses the real device id.
      expect(hub.requests, ['/api/devices', capabilitiesPath, statusPath]);

      // Commands too.
      await tester.tap(toggle('switch_1'));
      await tester.pumpAndSettle();
      expect(Uri.decodeComponent(hub.posts.single.url.path), commandsPath);
      expect(device.commands, [
        {'code': 'switch_1', 'value': true},
      ]);
    });

    testWidgets('clearing the custom name brings the Hub name back, live', (tester) async {
      final store = InMemoryDeviceNameStore();
      await store.setCustomName(realDeviceId, 'Đèn bếp');
      final (hub, _) = hubServing(chineseCapabilities());

      await pumpDetail(tester, hub, nameStore: store);
      expect(find.text('Đèn bếp'), findsOneWidget);
      expect(find.text('Tên gốc: W-W603 2'), findsOneWidget);

      await store.setCustomName(realDeviceId, null);
      await tester.pump();

      expect(find.text('Đèn bếp'), findsNothing);
      expect(find.text('W-W603 2'), findsOneWidget);
      expect(find.textContaining('Tên gốc'), findsNothing);
    });
  });
}
