import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/data/hub_api_exception.dart';
import 'package:tieu_home/features/devices/device_control_controller.dart';

import '../../support/fake_hub.dart';
import '../../support/fixtures.dart';

const String statusPath = '/api/devices/$switchDeviceId/status';
const String commandsPath = '/api/devices/$switchDeviceId/commands';

DeviceControlController controllerFor(FakeHub hub, {int attempts = 3}) {
  return DeviceControlController(
    client: hub.apiClient(),
    deviceId: switchDeviceId,
    confirmDelay: Duration.zero,
    confirmAttempts: attempts,
  );
}

Map<String, Object?> allOff() => {'switch_1': false, 'switch_2': false, 'switch_3': false};

void main() {
  group('loadStatus', () {
    test('reads the status the Hub reports', () async {
      final hub = FakeHub();
      hub.serveDevice(switchDeviceId, {'switch_1': true, 'switch_2': false});
      final controller = controllerFor(hub);

      expect(controller.status, isNull);
      expect(controller.valueOf('switch_1'), isNull);

      await controller.loadStatus();

      expect(controller.valueOf('switch_1'), isTrue);
      expect(controller.valueOf('switch_2'), isFalse);
      expect(controller.valueOf('switch_3'), isNull);
      expect(controller.isReadingStatus, isFalse);
      expect(controller.statusError, isNull);
      controller.dispose();
    });

    test('announces that it is reading, then that it is done', () async {
      final hub = FakeHub();
      hub.serveDevice(switchDeviceId, allOff());
      final controller = controllerFor(hub);
      final reading = <bool>[];
      controller.addListener(() => reading.add(controller.isReadingStatus));

      await controller.loadStatus();

      expect(reading, [true, false]);
      controller.dispose();
    });

    test('a failed read keeps what was known and records why', () async {
      final hub = FakeHub();
      hub.serveDevice(switchDeviceId, {'switch_1': true});
      final controller = controllerFor(hub);
      await controller.loadStatus();

      hub.failNetwork(statusPath);
      await controller.loadStatus();

      expect(controller.valueOf('switch_1'), isTrue);
      expect(controller.statusError?.kind, HubApiErrorKind.network);
      controller.dispose();
    });
  });

  group('setValue: success', () {
    test('sends the command, reads the status back and confirms it', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, allOff());
      final controller = controllerFor(hub);
      await controller.loadStatus();
      hub.calls.clear();

      await controller.setValue('switch_1', true);

      expect(device.commands, [
        {'code': 'switch_1', 'value': true},
      ]);
      expect(hub.calls, ['POST $commandsPath', 'GET $statusPath']);
      expect(controller.outcomeOf('switch_1'), isA<ControlConfirmed>());
      expect(controller.valueOf('switch_1'), isTrue);
      expect(controller.valueOf('switch_2'), isFalse);
      expect(controller.isPending('switch_1'), isFalse);
      controller.dispose();
    });

    test('turning it back off is confirmed the same way', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, {'switch_1': true});
      final controller = controllerFor(hub);
      await controller.loadStatus();

      await controller.setValue('switch_1', false);

      expect(device.commands.single, {'code': 'switch_1', 'value': false});
      expect(controller.outcomeOf('switch_1'), isA<ControlConfirmed>());
      expect(controller.valueOf('switch_1'), isFalse);
      controller.dispose();
    });

    test('waits for a device that reports the new value a moment late', () async {
      final hub = FakeHub()..respondPost(commandsPath, {'id': switchDeviceId, 'result': true});
      var reads = 0;
      hub.on(statusPath, () async {
        reads++;
        return jsonResponse({
          'id': switchDeviceId,
          'status': [
            {'code': 'switch_1', 'value': reads >= 2},
          ],
        });
      });
      final controller = controllerFor(hub);

      await controller.setValue('switch_1', true);

      expect(reads, 2);
      expect(controller.outcomeOf('switch_1'), isA<ControlConfirmed>());
      expect(controller.valueOf('switch_1'), isTrue);
      controller.dispose();
    });
  });

  group('setValue: failure', () {
    test('a rejected command is a failure, with no success claimed', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, allOff())..online = false;
      final controller = controllerFor(hub);
      await controller.loadStatus();
      hub.calls.clear();

      await controller.setValue('switch_1', true);

      final outcome = controller.outcomeOf('switch_1');
      expect(outcome, isA<ControlFailed>());
      expect((outcome! as ControlFailed).error.code, 'DEVICE_OFFLINE');
      // The displayed value is still what the device reported, not what was asked.
      expect(controller.valueOf('switch_1'), isFalse);
      // A rejected command is not followed by a status read.
      expect(hub.calls, ['POST $commandsPath']);
      expect(device.state['switch_1'], isFalse);
      expect(controller.isPending('switch_1'), isFalse);
      controller.dispose();
    });

    test('a network error is a failure', () async {
      final hub = FakeHub();
      hub.serveDevice(switchDeviceId, allOff());
      hub.failNetworkPost(commandsPath);
      final controller = controllerFor(hub);

      await controller.setValue('switch_1', true);

      final outcome = controller.outcomeOf('switch_1');
      expect(outcome, isA<ControlFailed>());
      expect((outcome! as ControlFailed).error.kind, HubApiErrorKind.network);
      controller.dispose();
    });

    test('after a failure the control can be used again', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, allOff())..online = false;
      final controller = controllerFor(hub);
      await controller.setValue('switch_1', true);
      expect(controller.outcomeOf('switch_1'), isA<ControlFailed>());

      device.online = true;
      await controller.setValue('switch_1', true);

      expect(controller.outcomeOf('switch_1'), isA<ControlConfirmed>());
      expect(device.commands, hasLength(2));
      controller.dispose();
    });
  });

  group('setValue: accepted but not confirmed', () {
    test('a device that keeps its old value is reported as unconfirmed', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, allOff())..applyCommands = false;
      final controller = controllerFor(hub);
      await controller.loadStatus();
      hub.calls.clear();

      await controller.setValue('switch_1', true);

      final outcome = controller.outcomeOf('switch_1');
      expect(outcome, isA<ControlUnconfirmed>());
      expect((outcome! as ControlUnconfirmed).statusError, isNull);
      expect(hub.calls.where((c) => c.startsWith('GET')), hasLength(3));
      // Shows what the device reports, never the value that was asked for.
      expect(controller.valueOf('switch_1'), isFalse);
      expect(device.state['switch_1'], isFalse);
      controller.dispose();
    });

    test('an unreadable status after an accepted command is unconfirmed, not a success', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, allOff());
      final controller = controllerFor(hub);
      await controller.loadStatus();
      hub.failNetwork(statusPath);

      await controller.setValue('switch_1', true);

      final outcome = controller.outcomeOf('switch_1');
      expect(outcome, isA<ControlUnconfirmed>());
      expect((outcome! as ControlUnconfirmed).statusError?.kind, HubApiErrorKind.network);
      // The command was sent; the app just cannot tell what happened.
      expect(device.commands, hasLength(1));
      // It keeps the last value it actually read.
      expect(controller.valueOf('switch_1'), isFalse);
      controller.dispose();
    });
  });

  group('pending state', () {
    test('locks only the control whose command is in flight', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, allOff());
      final gate = Completer<void>();
      device.gate = gate;
      final controller = controllerFor(hub);

      final first = controller.setValue('switch_1', true);
      expect(controller.isPending('switch_1'), isTrue);
      expect(controller.isPending('switch_2'), isFalse);

      // A second tap on the same control is ignored: no duplicate command.
      final duplicate = controller.setValue('switch_1', false);
      await duplicate;
      await pumpEventQueue();
      expect(device.commands, hasLength(1));
      expect(controller.isPending('switch_1'), isTrue);

      // An unrelated control is not blocked.
      final second = controller.setValue('switch_2', true);
      await pumpEventQueue();
      expect(controller.isPending('switch_2'), isTrue);
      expect(device.commands.map((c) => c['code']), ['switch_1', 'switch_2']);

      gate.complete();
      await Future.wait([first, second]);

      expect(controller.isPending('switch_1'), isFalse);
      expect(controller.isPending('switch_2'), isFalse);
      expect(controller.outcomeOf('switch_1'), isA<ControlConfirmed>());
      expect(controller.outcomeOf('switch_2'), isA<ControlConfirmed>());
      // Both reads overlapped, so read once more for a settled picture.
      await controller.loadStatus();
      expect(controller.valueOf('switch_1'), isTrue);
      expect(controller.valueOf('switch_2'), isTrue);
      controller.dispose();
    });

    test('clears a previous outcome as soon as a new command starts', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, allOff())..online = false;
      final controller = controllerFor(hub);
      await controller.setValue('switch_1', true);
      expect(controller.outcomeOf('switch_1'), isA<ControlFailed>());

      device.online = true;
      device.gate = Completer<void>();
      final pending = controller.setValue('switch_1', true);

      expect(controller.outcomeOf('switch_1'), isNull);
      device.gate!.complete();
      await pending;
      controller.dispose();
    });

    test('notifies listeners when a command starts and when it ends', () async {
      final hub = FakeHub();
      hub.serveDevice(switchDeviceId, allOff());
      final controller = controllerFor(hub);
      final seen = <bool>[];
      controller.addListener(() => seen.add(controller.isPending('switch_1')));

      await controller.setValue('switch_1', true);

      expect(seen.first, isTrue);
      expect(seen.last, isFalse);
      controller.dispose();
    });

    test('a result that arrives after dispose is dropped without error', () async {
      final hub = FakeHub();
      final device = hub.serveDevice(switchDeviceId, allOff());
      final gate = Completer<void>();
      device.gate = gate;
      final controller = controllerFor(hub);

      final pending = controller.setValue('switch_1', true);
      controller.dispose();
      gate.complete();

      await pending;
    });
  });
}
