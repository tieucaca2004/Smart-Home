import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/models/control_kind.dart';
import 'package:tieu_home/models/device_capabilities.dart';
import 'package:tieu_home/models/device_status.dart';

void main() {
  group('DeviceStatus.fromJson', () {
    test('reads the values the Hub reports, by code', () {
      final status = DeviceStatus.fromJson({
        'id': 'tuya:abc',
        'status': [
          {'code': 'switch_1', 'value': true},
          {'code': 'switch_2', 'value': false},
          {'code': 'countdown_1', 'value': 0},
          {'code': 'label', 'value': 'kitchen'},
        ],
      });

      expect(status['switch_1'], isTrue);
      expect(status['switch_2'], isFalse);
      expect(status['countdown_1'], 0);
      expect(status['label'], 'kitchen');
    });

    test('a code the device did not report is null, not false', () {
      final status = DeviceStatus.fromJson({
        'status': [
          {'code': 'switch_1', 'value': true},
        ],
      });

      expect(status['switch_9'], isNull);
    });

    test('an empty status list is valid', () {
      expect(DeviceStatus.fromJson({'status': <Object>[]}).values, isEmpty);
    });

    test('a status that is not a list is a format error', () {
      expect(() => DeviceStatus.fromJson({'status': 'on'}), throwsFormatException);
      expect(() => DeviceStatus.fromJson({'id': 'x'}), throwsFormatException);
    });

    test('an entry that is not an object, or has no code, is a format error', () {
      expect(() => DeviceStatus.fromJson({'status': [1]}), throwsFormatException);
      expect(
        () => DeviceStatus.fromJson({
          'status': [
            {'value': true},
          ],
        }),
        throwsFormatException,
      );
    });
  });

  group('CommandReceipt.fromJson', () {
    test('echoes what the Hub returned', () {
      final receipt = CommandReceipt.fromJson({
        'id': 'tuya:abc',
        'code': 'switch_1',
        'value': false,
        'result': true,
      });

      expect(receipt.code, 'switch_1');
      expect(receipt.value, isFalse);
      expect(receipt.result, isTrue);
    });

    test('is lenient: a sparse body must not turn an accepted command into an error', () {
      final receipt = CommandReceipt.fromJson({});

      expect(receipt.code, '');
      expect(receipt.value, isNull);
      expect(receipt.result, isNull);
    });
  });

  group('controlKindOf', () {
    ControlKind kindOfType(String type) =>
        controlKindOf(DeviceFunction(code: 'c', type: type));

    test('on/off capabilities get a toggle, whatever the type is spelled like', () {
      expect(kindOfType('Boolean'), ControlKind.toggle);
      expect(kindOfType('boolean'), ControlKind.toggle);
      expect(kindOfType('bool'), ControlKind.toggle);
    });

    test('other capabilities are not controllable yet', () {
      expect(kindOfType('Integer'), ControlKind.unsupported);
      expect(kindOfType('Enum'), ControlKind.unsupported);
      expect(kindOfType('unknown'), ControlKind.unsupported);
    });
  });
}
