import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/models/device_capabilities.dart';

import '../support/fixtures.dart';

void main() {
  group('DeviceCapabilities.fromJson', () {
    test('parses the Hub capabilities object', () {
      final body = switchCapabilitiesBody()['capabilities']! as Map<String, dynamic>;
      final capabilities = DeviceCapabilities.fromJson(body);

      expect(capabilities.id, switchDeviceId);
      expect(capabilities.protocol, 'tuya');
      expect(capabilities.name, 'W-W603 2');
      expect(capabilities.category, 'kg');
      expect(capabilities.online, isTrue);
      expect(capabilities.commands.map((c) => c.code), ['switch_1', 'countdown_1', 'mode']);
      expect(capabilities.commands.map((c) => c.type), ['Boolean', 'Integer', 'Enum']);
      expect(capabilities.statuses.map((c) => c.code), ['switch_1']);
    });

    test('missing lists mean "none", not an error', () {
      final capabilities = DeviceCapabilities.fromJson({'id': 'mqtt:lamp'});

      expect(capabilities.commands, isEmpty);
      expect(capabilities.statuses, isEmpty);
      expect(capabilities.protocol, 'unknown');
      expect(capabilities.nativeId, 'mqtt:lamp');
    });

    test('a list field that is not a list is a format error', () {
      expect(
        () => DeviceCapabilities.fromJson({'id': 'mqtt:lamp', 'commands': 'nope'}),
        throwsFormatException,
      );
    });

    test('a list entry that is not an object is a format error', () {
      expect(
        () => DeviceCapabilities.fromJson({
          'id': 'mqtt:lamp',
          'statuses': [42],
        }),
        throwsFormatException,
      );
    });

    test('an entry without a code is a format error', () {
      expect(
        () => DeviceCapabilities.fromJson({
          'id': 'mqtt:lamp',
          'commands': [
            {'type': 'Boolean'},
          ],
        }),
        throwsFormatException,
      );
    });

    test('a missing type becomes "unknown"', () {
      final function = DeviceFunction.fromJson({'code': 'x'});

      expect(function.type, 'unknown');
      expect(function.values, isNull);
    });
  });

  group('DeviceFunction.constraintSummary', () {
    DeviceFunction withValues(Map<String, dynamic>? values) =>
        DeviceFunction(code: 'c', type: 'T', values: values);

    test('lists the allowed options of an enum', () {
      final summary = withValues({
        'range': ['cold', 'hot'],
      }).constraintSummary;

      expect(summary, 'cold / hot');
    });

    test('shows a numeric span with its unit', () {
      final summary = withValues({'min': 0, 'max': 86400, 'unit': 's'}).constraintSummary;

      expect(summary, '0–86400 s');
    });

    test('shows a numeric span without a unit and keeps decimals', () {
      expect(withValues({'min': 0, 'max': 100}).constraintSummary, '0–100');
      expect(withValues({'min': 0.5, 'max': 1.5}).constraintSummary, '0.5–1.5');
    });

    test('is null when there is nothing useful to show', () {
      expect(withValues(null).constraintSummary, isNull);
      expect(withValues(<String, dynamic>{}).constraintSummary, isNull);
      expect(withValues({'range': <String>[]}).constraintSummary, isNull);
      expect(withValues({'min': 0}).constraintSummary, isNull);
    });
  });
}
