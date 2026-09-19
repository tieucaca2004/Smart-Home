import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/models/device.dart';

void main() {
  group('Device.fromJson', () {
    test('parses a full entry as the Hub sends it', () {
      final device = Device.fromJson({
        'id': 'tuya:1638018234ab950e1ecd',
        'nativeId': '1638018234ab950e1ecd',
        'protocol': 'tuya',
        'name': 'W-W603 2',
        'category': 'kg',
        'online': true,
      });

      expect(device.id, 'tuya:1638018234ab950e1ecd');
      expect(device.nativeId, '1638018234ab950e1ecd');
      expect(device.protocol, 'tuya');
      expect(device.name, 'W-W603 2');
      expect(device.category, 'kg');
      expect(device.online, isTrue);
      expect(device.onlineState, OnlineState.online);
      expect(device.error, isNull);
    });

    test('keeps Vietnamese text and an offline device', () {
      final device = Device.fromJson({
        'id': 'matter:abc123',
        'nativeId': 'abc123',
        'protocol': 'matter',
        'name': 'Đèn phòng khách',
        'category': 'light',
        'online': false,
      });

      expect(device.name, 'Đèn phòng khách');
      expect(device.protocol, 'matter');
      expect(device.onlineState, OnlineState.offline);
    });

    test('a failed lookup has identity and error only', () {
      final device = Device.fromJson({
        'id': 'tuya:abc',
        'nativeId': 'abc',
        'protocol': 'tuya',
        'error': 'Upstream lookup failed',
      });

      expect(device.error, 'Upstream lookup failed');
      expect(device.name, isNull);
      expect(device.category, isNull);
      expect(device.online, isNull);
      expect(device.onlineState, OnlineState.unknown);
      expect(device.displayName, 'abc');
    });

    test('never parses the opaque id: missing fields fall back, not derive', () {
      final device = Device.fromJson({'id': 'zigbee:00:11:22'});

      expect(device.protocol, 'unknown');
      expect(device.nativeId, 'zigbee:00:11:22');
      expect(device.id, 'zigbee:00:11:22');
    });

    test('treats empty strings as absent', () {
      final device = Device.fromJson({
        'id': 'mqtt:lamp',
        'name': '',
        'category': '',
      });

      expect(device.name, isNull);
      expect(device.category, isNull);
      expect(device.displayName, 'mqtt:lamp');
    });

    test('a non-boolean online value is "unknown", not offline', () {
      final device = Device.fromJson({'id': 'mqtt:lamp', 'online': 'yes'});

      expect(device.online, isNull);
      expect(device.onlineState, OnlineState.unknown);
    });

    test('an entry without an id is rejected', () {
      expect(() => Device.fromJson({'name': 'x'}), throwsFormatException);
      expect(() => Device.fromJson({'id': ''}), throwsFormatException);
      expect(() => Device.fromJson({'id': 42}), throwsFormatException);
    });
  });
}
