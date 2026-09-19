import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/features/devices/control_messages.dart';
import 'package:tieu_home/features/devices/device_detail_screen.dart';
import 'package:tieu_home/models/device.dart';

import '../../support/fake_hub.dart';
import '../../support/fixtures.dart';

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

Finder toggle(String code) => find.byKey(ValueKey('toggle-$code'));
Finder tile(String code) => find.byKey(ValueKey('control-$code'));
Finder spinnerIn(String code) =>
    find.descendant(of: tile(code), matching: find.byType(CircularProgressIndicator));

bool isOn(WidgetTester tester, String code) => tester.widget<Switch>(toggle(code)).value;

Future<void> pumpDetail(WidgetTester tester, FakeHub hub, {Device device = realDevice}) async {
  tester.view.physicalSize = const Size(800, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(home: DeviceDetailScreen(device: device, client: hub.apiClient())),
  );
}

/// A Hub serving the real device: capabilities plus an in-memory device behind
/// its status and command routes.
(FakeHub, FakeControllableDevice) realHub({
  Map<String, Object?>? state,
  bool? online = true,
}) {
  final hub = FakeHub()..respond(capabilitiesPath, realDeviceCapabilitiesBody(online: online));
  final device = hub.serveDevice(
    realDeviceId,
    state ?? {'switch_1': false, 'switch_2': false, 'switch_3': false},
  );
  return (hub, device);
}

void main() {
  group('controls are generated from capabilities', () {
    testWidgets('one switch per Boolean command of the real device', (tester) async {
      final (hub, _) = realHub();

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();

      expect(find.text('Điều khiển'), findsOneWidget);
      expect(find.byType(Switch), findsNWidgets(3));
      for (final code in ['switch_1', 'switch_2', 'switch_3']) {
        expect(toggle(code), findsOneWidget, reason: code);
      }
      expect(find.text('Switch 1'), findsOneWidget);
      // Integer commands are listed but get no switch.
      expect(toggle('countdown_1'), findsNothing);
      expect(find.text('countdown_1'), findsWidgets);
    });

    testWidgets('does not depend on the codes switch_1/2/3 or on the protocol', (tester) async {
      const id = 'zigbee:lamp-1';
      final hub = FakeHub()
        ..respond(
          '/api/devices/$id/capabilities',
          capabilitiesBody(
            id,
            protocol: 'zigbee',
            commands: [
              {'code': 'relay_a', 'type': 'Boolean', 'values': <String, Object?>{}},
              {'code': 'night_light', 'type': 'Boolean', 'name': 'Đèn ngủ', 'values': <String, Object?>{}},
              {'code': 'level', 'type': 'Integer', 'values': {'min': 0, 'max': 100}},
            ],
          ),
        );
      hub.serveDevice(id, {'relay_a': true, 'night_light': false});

      await pumpDetail(
        tester,
        hub,
        device: const Device(id: id, nativeId: 'lamp-1', protocol: 'zigbee', name: 'Đèn'),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Switch), findsNWidgets(2));
      expect(isOn(tester, 'relay_a'), isTrue);
      expect(isOn(tester, 'night_light'), isFalse);
      expect(find.text('Đèn ngủ'), findsWidgets);
      expect(find.text('Relay a'), findsOneWidget);
      expect(toggle('level'), findsNothing);
    });

    testWidgets('a device with no on/off command shows no controls and reads no status', (tester) async {
      final hub = FakeHub()
        ..respond(
          capabilitiesPath,
          capabilitiesBody(
            realDeviceId,
            commands: [
              {'code': 'countdown_1', 'type': 'Integer', 'values': <String, Object?>{}},
            ],
          ),
        );

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();

      expect(find.text('Điều khiển'), findsNothing);
      expect(find.byType(Switch), findsNothing);
      expect(hub.calls, ['GET $capabilitiesPath']);
    });
  });

  group('switch state', () {
    testWidgets('shows the state the device reports', (tester) async {
      final (hub, _) = realHub(state: {'switch_1': true, 'switch_2': false, 'switch_3': true});

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();

      expect(isOn(tester, 'switch_1'), isTrue);
      expect(isOn(tester, 'switch_2'), isFalse);
      expect(isOn(tester, 'switch_3'), isTrue);
      expect(find.text('switch_1 · Đang bật'), findsOneWidget);
      expect(find.text('switch_2 · Đang tắt'), findsOneWidget);
      expect(hub.calls, ['GET $capabilitiesPath', 'GET $statusPath']);
    });

    testWidgets('the refresh action reads the status again', (tester) async {
      final (hub, device) = realHub();

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();
      expect(isOn(tester, 'switch_1'), isFalse);

      // Someone flips the wall switch.
      device.state['switch_1'] = true;
      await tester.tap(find.byTooltip('Đọc lại trạng thái'));
      await tester.pumpAndSettle();

      expect(isOn(tester, 'switch_1'), isTrue);
      expect(hub.requests.where((p) => p == statusPath), hasLength(2));
    });

    testWidgets('a code the device does not report gets explicit Bật / Tắt buttons, not a guess', (tester) async {
      final (hub, device) = realHub(state: {'switch_1': false});

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();

      expect(toggle('switch_2'), findsNothing);
      expect(find.byKey(const ValueKey('on-switch_2')), findsOneWidget);
      expect(find.text('switch_2 · Không rõ trạng thái'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('on-switch_2')));
      await tester.pumpAndSettle();

      expect(device.commands, [
        {'code': 'switch_2', 'value': true},
      ]);
      expect(isOn(tester, 'switch_2'), isTrue);
    });
  });

  group('real command interaction', () {
    testWidgets('OFF to ON then ON to OFF: sends the Hub command, reads the status back, reconciles', (tester) async {
      final (hub, device) = realHub();

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();
      hub.calls.clear();

      await tester.tap(toggle('switch_1'));
      await tester.pumpAndSettle();

      expect(device.commands, [
        {'code': 'switch_1', 'value': true},
      ]);
      expect(hub.calls, ['POST $commandsPath', 'GET $statusPath']);
      expect(isOn(tester, 'switch_1'), isTrue);
      expect(isOn(tester, 'switch_2'), isFalse);
      expect(find.text('Thiết bị đã xác nhận.'), findsOneWidget);

      await tester.tap(toggle('switch_1'));
      await tester.pumpAndSettle();

      expect(device.commands.last, {'code': 'switch_1', 'value': false});
      expect(isOn(tester, 'switch_1'), isFalse);
      expect(device.state['switch_1'], isFalse);
      expect(spinnerIn('switch_1'), findsNothing);
    });

    testWidgets('while a command is pending only that control is locked', (tester) async {
      final (hub, device) = realHub();
      final gate = Completer<void>();
      device.gate = gate;

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();

      await tester.tap(toggle('switch_1'));
      await tester.pump();

      // switch_1: progress instead of a switch, and a clear label.
      expect(spinnerIn('switch_1'), findsOneWidget);
      expect(toggle('switch_1'), findsNothing);
      expect(find.text('switch_1 · Đang gửi lệnh…'), findsOneWidget);
      // The others are still usable.
      expect(toggle('switch_2'), findsOneWidget);
      expect(tester.widget<Switch>(toggle('switch_2')).onChanged, isNotNull);
      expect(spinnerIn('switch_2'), findsNothing);

      await tester.tap(toggle('switch_2'));
      await tester.pump();
      expect(device.commands.map((c) => c['code']), ['switch_1', 'switch_2']);
      expect(spinnerIn('switch_2'), findsOneWidget);

      gate.complete();
      await tester.pumpAndSettle();

      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(isOn(tester, 'switch_1'), isTrue);
      expect(isOn(tester, 'switch_2'), isTrue);
      expect(isOn(tester, 'switch_3'), isFalse);
    });

    testWidgets('a command the Hub rejects shows the error and no success', (tester) async {
      // The Hub thinks the device is online, but the command says otherwise.
      final (hub, device) = realHub();
      device.online = false;

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();
      hub.calls.clear();

      await tester.tap(toggle('switch_1'));
      await tester.pumpAndSettle();

      expect(find.text('Thiết bị đang ngoại tuyến nên chưa nhận được lệnh.'), findsOneWidget);
      expect(find.text('Thiết bị đã xác nhận.'), findsNothing);
      // The switch still shows what the device reported.
      expect(isOn(tester, 'switch_1'), isFalse);
      expect(hub.calls, ['POST $commandsPath']);
      expect(spinnerIn('switch_1'), findsNothing);
    });

    testWidgets('a network error shows a Vietnamese message and no success', (tester) async {
      final (hub, _) = realHub();
      hub.failNetworkPost(commandsPath);

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();

      await tester.tap(toggle('switch_3'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Không kết nối được với Hub nên lệnh chưa được thực hiện'), findsOneWidget);
      expect(find.text('Thiết bị đã xác nhận.'), findsNothing);
      expect(isOn(tester, 'switch_3'), isFalse);
    });

    testWidgets('a command the device ignores is flagged, and the switch keeps the reported state', (tester) async {
      final (hub, device) = realHub();
      device.applyCommands = false;

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();

      await tester.tap(toggle('switch_1'));
      await tester.pumpAndSettle();

      expect(find.textContaining('thiết bị chưa báo trạng thái mới'), findsOneWidget);
      expect(find.text('Thiết bị đã xác nhận.'), findsNothing);
      expect(isOn(tester, 'switch_1'), isFalse);
    });

    testWidgets('if the status cannot be read back the app says it cannot confirm', (tester) async {
      final (hub, device) = realHub();

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();
      hub.failNetwork(statusPath);

      await tester.tap(toggle('switch_1'));
      await tester.pumpAndSettle();

      expect(device.commands, hasLength(1));
      expect(find.textContaining('không đọc lại được trạng thái để xác nhận'), findsOneWidget);
      expect(find.text('Thiết bị đã xác nhận.'), findsNothing);
      expect(isOn(tester, 'switch_1'), isFalse);
    });
  });

  group('offline device', () {
    testWidgets('capabilities say offline: no switches, a Vietnamese message, nothing sent', (tester) async {
      final (hub, device) = realHub(online: false);

      await pumpDetail(tester, hub);
      await tester.pumpAndSettle();

      expect(find.text(offlineDeviceNotice), findsOneWidget);
      expect(find.byType(Switch), findsNothing);
      expect(find.text('switch_1 · Thiết bị ngoại tuyến'), findsOneWidget);
      expect(hub.posts, isEmpty);
      expect(device.commands, isEmpty);
      // It does not present stale values for a device that is not reachable.
      expect(hub.requests, [capabilitiesPath]);
    });

    testWidgets('the device list says offline: same behavior', (tester) async {
      final (hub, _) = realHub(online: null);

      await pumpDetail(
        tester,
        hub,
        device: const Device(
          id: realDeviceId,
          nativeId: '1638018234ab950e1ecd',
          protocol: 'tuya',
          online: false,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text(offlineDeviceNotice), findsOneWidget);
      expect(find.byType(Switch), findsNothing);
      expect(hub.posts, isEmpty);
    });
  });
}
