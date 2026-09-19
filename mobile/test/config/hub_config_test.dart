import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/config/hub_config.dart';

Uri resolve(String configured, [TargetPlatform platform = TargetPlatform.android]) =>
    HubConfig.resolve(configured: configured, platform: platform);

void main() {
  group('HubConfig.resolve defaults (no HUB_BASE_URL)', () {
    test('Android emulator reaches the host through 10.0.2.2', () {
      expect(resolve('').toString(), 'http://10.0.2.2:3000');
    });

    test('iOS simulator uses localhost', () {
      expect(resolve('', TargetPlatform.iOS).toString(), 'http://localhost:3000');
    });

    test('other platforms use localhost', () {
      expect(resolve('', TargetPlatform.macOS).toString(), 'http://localhost:3000');
    });

    test('blank counts as not provided', () {
      expect(resolve('   ').toString(), 'http://10.0.2.2:3000');
    });
  });

  group('HubConfig.resolve with HUB_BASE_URL', () {
    test('uses a LAN address as given, on any platform', () {
      expect(resolve('http://192.168.1.50:3000').toString(), 'http://192.168.1.50:3000');
      expect(
        resolve('http://192.168.1.50:3000', TargetPlatform.iOS).toString(),
        'http://192.168.1.50:3000',
      );
    });

    test('assumes http when no scheme is written', () {
      final uri = resolve('192.168.1.50:3000');

      expect(uri.scheme, 'http');
      expect(uri.host, '192.168.1.50');
      expect(uri.port, 3000);
    });

    test('trims surrounding whitespace', () {
      expect(resolve('  http://hub.local:3000 ').host, 'hub.local');
    });

    test('accepts https', () {
      expect(resolve('https://hub.example.com').scheme, 'https');
    });

    test('rejects other schemes and missing hosts with a Vietnamese message', () {
      for (final bad in ['ftp://192.168.1.50:3000', 'http://', 'file:///tmp/hub']) {
        expect(
          () => resolve(bad),
          throwsA(
            isA<FormatException>().having((e) => e.message, 'message', contains('HUB_BASE_URL không hợp lệ')),
          ),
          reason: bad,
        );
      }
    });
  });
}
