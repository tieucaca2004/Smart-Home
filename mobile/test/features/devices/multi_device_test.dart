import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:tieu_home/app.dart';
import 'package:tieu_home/features/devices/control_messages.dart';

import '../../support/fake_hub.dart';
import '../../support/fixtures.dart';

// Sprint 3A: the app shows whatever GET /api/devices returns, and every device
// screen works from the id of the device that was chosen. Nothing here uses the
// device from earlier sprints (W-W603 2): these are other devices, of other
// categories, with other command codes, so a device (or a number of devices)
// built into the app would fail these tests.

class DeviceSpec {
  DeviceSpec(
    this.id, {
    this.name,
    this.category = 'kg',
    this.online = true,
    this.commands = const [],
    this.state = const {},
  });

  final String id;
  final String? name;
  final String category;

  /// null = the Hub does not say.
  final bool? online;
  final List<Map<String, Object?>> commands;

  /// What the device reports through `GET .../status`.
  final Map<String, Object?> state;

  String get nativeId => id.substring(id.indexOf(':') + 1);

  /// The entry `GET /api/devices` has for this device.
  Map<String, Object?> get listEntry => {
        'id': id,
        'nativeId': nativeId,
        'protocol': 'tuya',
        'name': ?name,
        'category': category,
        'online': ?online,
      };
}

Map<String, Object?> boolCmd(String code, {String? name}) =>
    {'code': code, 'type': 'Boolean', 'name': ?name, 'values': <String, Object?>{}};

Map<String, Object?> intCmd(String code) => {
      'code': code,
      'type': 'Integer',
      'values': {'min': 0, 'max': 100, 'scale': 0, 'step': 1},
    };

Map<String, Object?> enumCmd(String code, List<String> range) =>
    {'code': code, 'type': 'Enum', 'values': {'range': range}};

/// A two-gang switch with Chinese names, like the vendor sends them.
final DeviceSpec gang = DeviceSpec(
  'tuya:dev-a',
  name: 'Công tắc phòng khách',
  category: 'kg',
  commands: [boolCmd('switch_1', name: '开关1'), boolCmd('switch_2', name: '开关2'), intCmd('countdown_1')],
  state: {'switch_1': true, 'switch_2': false},
);

/// A fan with a light: Boolean commands that are not switch_N, plus an Enum.
final DeviceSpec fan = DeviceSpec(
  'tuya:dev-b',
  name: 'Quạt trần',
  category: 'fs',
  commands: [boolCmd('switch'), boolCmd('light'), enumCmd('fan_speed', ['low', 'high'])],
  state: {'switch': false, 'light': true},
);

/// A socket that is offline.
final DeviceSpec plug = DeviceSpec(
  'tuya:dev-c',
  name: 'Ổ cắm bếp',
  category: 'cz',
  online: false,
  commands: [boolCmd('switch_1')],
  state: {'switch_1': true},
);

/// A sensor with nothing to switch: no Boolean command.
final DeviceSpec sensor = DeviceSpec(
  'tuya:dev-d',
  name: 'Cảm biến cửa',
  category: 'mcs',
  commands: [intCmd('report_interval'), enumCmd('sensitivity', ['low', 'mid', 'high'])],
);

String capsPath(DeviceSpec d) => '/api/devices/${d.id}/capabilities';
String statusPath(DeviceSpec d) => '/api/devices/${d.id}/status';
String commandsPath(DeviceSpec d) => '/api/devices/${d.id}/commands';

/// A Hub that has exactly these devices: the list, and per device its
/// capabilities plus an in-memory device behind status and commands.
(FakeHub, Map<String, FakeControllableDevice>) buildHub(List<DeviceSpec> specs) {
  final hub = FakeHub()
    ..respond('/api/devices', {
      'devices': [for (final spec in specs) spec.listEntry],
    });
  final devices = <String, FakeControllableDevice>{};
  for (final spec in specs) {
    hub.respond(
      capsPath(spec),
      capabilitiesBody(spec.id, name: spec.name, online: spec.online, commands: spec.commands),
    );
    devices[spec.id] = hub.serveDevice(spec.id, spec.state);
  }
  return (hub, devices);
}

Future<void> pumpApp(WidgetTester tester, FakeHub hub) async {
  tester.view.physicalSize = const Size(800, 4000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(TieuHomeApp(client: hub.apiClient()));
  await tester.pumpAndSettle();
}

Future<void> openDevice(WidgetTester tester, String name) async {
  await tester.tap(find.text(name));
  await tester.pumpAndSettle();
}

Future<void> goBack(WidgetTester tester) async {
  await tester.pageBack();
  await tester.pumpAndSettle();
}

Finder toggle(String code) => find.byKey(ValueKey('toggle-$code'));
Finder tile(String code) => find.byKey(ValueKey('control-$code'));
Finder inTile(String code, String text) =>
    find.descendant(of: tile(code), matching: find.text(text));
bool isOn(WidgetTester tester, String code) => tester.widget<Switch>(toggle(code)).value;

/// The path a request was sent to (device ids contain a colon, which may be percent-encoded).
String pathOf(http.Request request) => Uri.decodeComponent(request.url.path);

void main() {
  group('the device list shows what the Hub returns', () {
    testWidgets('every device, with its name, category, protocol and online state', (tester) async {
      final (hub, _) = buildHub([gang, fan, plug, sensor]);

      await pumpApp(tester, hub);

      expect(find.byType(ListTile), findsNWidgets(4));
      for (final name in ['Công tắc phòng khách', 'Quạt trần', 'Ổ cắm bếp', 'Cảm biến cửa']) {
        expect(find.text(name), findsOneWidget, reason: name);
      }
      expect(find.text('kg · tuya'), findsOneWidget);
      expect(find.text('fs · tuya'), findsOneWidget);
      expect(find.text('cz · tuya'), findsOneWidget);
      expect(find.text('mcs · tuya'), findsOneWidget);
      // Three are online, one is offline, and the list tells them apart.
      expect(find.text('Trực tuyến'), findsNWidgets(3));
      expect(find.text('Ngoại tuyến'), findsOneWidget);
      // Nothing of the device from earlier sprints is built in.
      expect(find.text('W-W603 2'), findsNothing);
    });

    for (final count in [1, 2, 12]) {
      testWidgets('the number of devices is not fixed: $count device(s)', (tester) async {
        final specs = [
          for (var i = 1; i <= count; i++)
            DeviceSpec(
              'tuya:gen-$i',
              name: 'Thiết bị mẫu $i',
              category: i.isEven ? 'fs' : 'kg',
              online: i % 3 != 0,
            ),
        ];
        final (hub, _) = buildHub(specs);

        await pumpApp(tester, hub);

        expect(find.byType(ListTile), findsNWidgets(count));
        for (var i = 1; i <= count; i++) {
          expect(find.text('Thiết bị mẫu $i'), findsOneWidget, reason: 'device $i');
        }
        final offline = specs.where((s) => s.online == false).length;
        expect(find.text('Ngoại tuyến'), findsNWidgets(offline));
        expect(find.text('Trực tuyến'), findsNWidgets(count - offline));
      });
    }

    testWidgets('a device the Hub does not say is online is not shown as online', (tester) async {
      final (hub, _) = buildHub([DeviceSpec('tuya:dev-x', name: 'Đèn hành lang', online: null)]);

      await pumpApp(tester, hub);

      expect(find.text('Đèn hành lang'), findsOneWidget);
      expect(find.text('Không rõ'), findsOneWidget);
      expect(find.text('Trực tuyến'), findsNothing);
      expect(find.text('Ngoại tuyến'), findsNothing);
    });

    testWidgets('an empty Hub shows the empty state, and reload picks up devices that appear later',
        (tester) async {
      final hub = FakeHub()..respond('/api/devices', {'devices': <Object>[]});

      await pumpApp(tester, hub);

      expect(find.text('Hub chưa có thiết bị nào'), findsOneWidget);
      expect(find.byType(ListTile), findsNothing);

      hub.respond('/api/devices', {
        'devices': [gang.listEntry, fan.listEntry],
      });
      await tester.tap(find.text('Tải lại').first);
      await tester.pumpAndSettle();

      expect(find.text('Hub chưa có thiết bị nào'), findsNothing);
      expect(find.byType(ListTile), findsNWidgets(2));
    });

    testWidgets('when the Hub cannot be reached there is an error with retry, and retry lists every device',
        (tester) async {
      final (hub, _) = buildHub([gang, fan, plug]);
      hub.failNetwork('/api/devices');

      await pumpApp(tester, hub);

      expect(find.text('Không kết nối được với Hub'), findsOneWidget);
      expect(find.byType(ListTile), findsNothing);

      hub.respond('/api/devices', {
        'devices': [gang.listEntry, fan.listEntry, plug.listEntry],
      });
      await tester.tap(find.text('Thử lại'));
      await tester.pumpAndSettle();

      expect(find.text('Không kết nối được với Hub'), findsNothing);
      expect(find.byType(ListTile), findsNWidgets(3));
    });
  });

  group('choosing a device opens that device', () {
    testWidgets('device A: its id, its capabilities, its status, its controls; nothing of B', (tester) async {
      final (hub, _) = buildHub([gang, fan]);

      await pumpApp(tester, hub);
      await openDevice(tester, gang.name!);

      expect(hub.requests, ['/api/devices', capsPath(gang), statusPath(gang)]);
      expect(find.text(gang.id), findsOneWidget);
      // Controls come from A's capabilities: two switches, labelled in Vietnamese.
      expect(find.byType(Switch), findsNWidgets(2));
      expect(inTile('switch_1', 'Công tắc 1'), findsOneWidget);
      expect(inTile('switch_2', 'Công tắc 2'), findsOneWidget);
      expect(isOn(tester, 'switch_1'), isTrue);
      expect(isOn(tester, 'switch_2'), isFalse);
      // B's controls are not here.
      expect(toggle('light'), findsNothing);
      expect(toggle('switch'), findsNothing);
    });

    testWidgets('device B after A: B\'s id, capabilities, status and controls, built from B\'s data',
        (tester) async {
      final (hub, _) = buildHub([gang, fan]);

      await pumpApp(tester, hub);
      await openDevice(tester, gang.name!);
      await goBack(tester);
      await openDevice(tester, fan.name!);

      expect(hub.requests, [
        '/api/devices',
        capsPath(gang),
        statusPath(gang),
        capsPath(fan),
        statusPath(fan),
      ]);
      expect(find.text(fan.id), findsOneWidget);
      // Boolean commands with codes the app has never seen get switches; the Enum does not.
      expect(find.byType(Switch), findsNWidgets(2));
      expect(isOn(tester, 'switch'), isFalse);
      expect(isOn(tester, 'light'), isTrue);
      expect(toggle('fan_speed'), findsNothing);
      // A's controls are gone.
      expect(toggle('switch_1'), findsNothing);
      expect(toggle('switch_2'), findsNothing);
    });

    testWidgets('B does not inherit A\'s state, even for the same command code', (tester) async {
      final a = DeviceSpec(
        'tuya:pair-a',
        name: 'Công tắc A',
        commands: [boolCmd('switch_1')],
        state: {'switch_1': true},
      );
      final b = DeviceSpec(
        'tuya:pair-b',
        name: 'Công tắc B',
        commands: [boolCmd('switch_1')],
        state: {'switch_1': false},
      );
      final (hub, _) = buildHub([a, b]);

      await pumpApp(tester, hub);
      await openDevice(tester, 'Công tắc A');
      expect(isOn(tester, 'switch_1'), isTrue);
      expect(inTile('switch_1', 'Đang bật'), findsOneWidget);
      await goBack(tester);

      await openDevice(tester, 'Công tắc B');
      expect(isOn(tester, 'switch_1'), isFalse);
      expect(inTile('switch_1', 'Đang tắt'), findsOneWidget);
      expect(hub.requests.last, statusPath(b));
    });

    testWidgets('a command goes to the device that is open, and only to it', (tester) async {
      final (hub, devices) = buildHub([gang, fan]);

      await pumpApp(tester, hub);

      await openDevice(tester, gang.name!);
      await tester.tap(toggle('switch_1'));
      await tester.pumpAndSettle();

      expect(devices[gang.id]!.commands, [
        {'code': 'switch_1', 'value': false},
      ]);
      expect(devices[fan.id]!.commands, isEmpty);
      expect(hub.posts.map(pathOf), [commandsPath(gang)]);
      expect(find.text('Thiết bị đã xác nhận.'), findsOneWidget);

      await goBack(tester);
      await openDevice(tester, fan.name!);
      await tester.tap(toggle('light'));
      await tester.pumpAndSettle();

      expect(devices[fan.id]!.commands, [
        {'code': 'light', 'value': false},
      ]);
      expect(devices[gang.id]!.commands, hasLength(1));
      expect(hub.posts.map(pathOf), [commandsPath(gang), commandsPath(fan)]);
      expect(isOn(tester, 'light'), isFalse);
    });
  });

  group('offline devices', () {
    testWidgets('an offline device is listed as offline, opens safely, and receives no command', (tester) async {
      final (hub, devices) = buildHub([gang, plug]);

      await pumpApp(tester, hub);
      expect(find.text('Ngoại tuyến'), findsOneWidget);
      expect(find.text('Trực tuyến'), findsOneWidget);

      await openDevice(tester, plug.name!);

      expect(find.text('Ngoại tuyến'), findsOneWidget);
      expect(find.text(offlineDeviceNotice), findsOneWidget);
      expect(find.byType(Switch), findsNothing);
      expect(find.text('Trực tuyến'), findsNothing);
      // Nothing is sent, and the (unreachable) device is not asked for a status.
      expect(hub.posts, isEmpty);
      expect(devices[plug.id]!.commands, isEmpty);
      expect(hub.requests, ['/api/devices', capsPath(plug)]);
    });

    testWidgets('going from an offline device to an online one restores its controls', (tester) async {
      final (hub, devices) = buildHub([plug, gang]);

      await pumpApp(tester, hub);
      await openDevice(tester, plug.name!);
      expect(find.byType(Switch), findsNothing);
      await goBack(tester);

      await openDevice(tester, gang.name!);
      expect(find.byType(Switch), findsNWidgets(2));
      await tester.tap(toggle('switch_2'));
      await tester.pumpAndSettle();

      expect(devices[gang.id]!.commands, [
        {'code': 'switch_2', 'value': true},
      ]);
      expect(devices[plug.id]!.commands, isEmpty);
    });
  });

  group('a device whose details cannot be used', () {
    testWidgets('no Boolean command: the device opens with no controls and no status read', (tester) async {
      final (hub, _) = buildHub([sensor]);

      await pumpApp(tester, hub);
      await openDevice(tester, sensor.name!);

      expect(find.text(sensor.name!), findsOneWidget);
      expect(find.text('Điều khiển'), findsNothing);
      expect(find.byType(Switch), findsNothing);
      expect(find.text('Lệnh thiết bị hỗ trợ'), findsOneWidget);
      expect(hub.requests, ['/api/devices', capsPath(sensor)]);
      expect(hub.posts, isEmpty);
    });

    testWidgets('capabilities cannot be fetched: the error is shown inline, and retry works', (tester) async {
      final (hub, _) = buildHub([gang]);
      hub.failNetwork(capsPath(gang));

      await pumpApp(tester, hub);
      await openDevice(tester, gang.name!);

      expect(find.text(gang.name!), findsOneWidget);
      expect(find.text('Không kết nối được với Hub'), findsOneWidget);
      expect(find.byType(Switch), findsNothing);
      expect(hub.posts, isEmpty);

      hub.respond(
        capsPath(gang),
        capabilitiesBody(gang.id, name: gang.name, online: true, commands: gang.commands),
      );
      await tester.tap(find.text('Thử lại'));
      await tester.pumpAndSettle();

      expect(find.text('Không kết nối được với Hub'), findsNothing);
      expect(find.byType(Switch), findsNWidgets(2));
    });

    testWidgets('the Hub does not know the device (404): a clear message, nothing to switch', (tester) async {
      final (hub, _) = buildHub([fan]);
      hub.respond(
        capsPath(fan),
        {'error': 'Device not found', 'code': 'DEVICE_NOT_FOUND', 'id': fan.id},
        404,
      );

      await pumpApp(tester, hub);
      await openDevice(tester, fan.name!);

      expect(find.text('Hub không tìm thấy thiết bị này'), findsOneWidget);
      expect(find.byType(Switch), findsNothing);
      expect(hub.posts, isEmpty);
    });
  });

  group('nothing about a particular device is built into the app', () {
    // Comments may give examples; code may not contain a device id, a device
    // name, a category, a protocol or a fixed switch code as a literal.
    final forbidden = <String, RegExp>{
      'a device id': RegExp('1638018234ab950e1ecd'),
      'a device name': RegExp('W-W603'),
      'a category': RegExp(r'''['"]kg['"]'''),
      'a fixed switch code': RegExp(r'''['"]switch_\d+['"]'''),
      'a fixed countdown code': RegExp(r'''['"]countdown_\d+['"]'''),
      'a protocol literal': RegExp(r'''['"]tuya['":]'''),
    };

    test('lib/ has no such literal outside comments', () {
      final files = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .toList();
      expect(files, isNotEmpty, reason: 'run flutter test from the mobile/ folder');

      final offenders = <String>[];
      for (final file in files) {
        final lines = file.readAsLinesSync();
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].trimLeft().startsWith('//')) continue;
          forbidden.forEach((what, pattern) {
            if (pattern.hasMatch(lines[i])) {
              offenders.add('${file.path}:${i + 1} has $what: ${lines[i].trim()}');
            }
          });
        }
      }

      expect(offenders, isEmpty);
    });
  });
}
