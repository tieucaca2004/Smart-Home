import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:tieu_home/data/hub_api_client.dart';
import 'package:tieu_home/data/hub_api_exception.dart';

import '../support/fake_hub.dart';
import '../support/fixtures.dart';

TypeMatcher<HubApiException> hubError(HubApiErrorKind kind, {int? statusCode, String? code}) {
  return isA<HubApiException>()
      .having((e) => e.kind, 'kind', kind)
      .having((e) => e.statusCode, 'statusCode', statusCode)
      .having((e) => e.code, 'code', code);
}

void main() {
  group('fetchDevices', () {
    test('parses the device list from GET /api/devices', () async {
      final hub = FakeHub()..respond('/api/devices', devicesBody());

      final devices = await hub.apiClient().fetchDevices();

      expect(devices, hasLength(3));
      expect(devices[0].id, switchDeviceId);
      expect(devices[0].name, 'W-W603 2');
      expect(devices[0].online, isTrue);
      expect(devices[1].name, 'Đèn phòng khách');
      expect(devices[1].protocol, 'matter');
      expect(devices[2].error, 'Upstream lookup failed');
      expect(hub.requests, ['/api/devices']);
    });

    test('an empty list is a valid answer', () async {
      final hub = FakeHub()..respond('/api/devices', {'devices': <Object>[]});

      expect(await hub.apiClient().fetchDevices(), isEmpty);
    });

    test('sends a GET with an Accept: application/json header', () async {
      late http.Request seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        httpClient: MockClient((request) async {
          seen = request;
          return jsonResponse(devicesBody());
        }),
      );

      await client.fetchDevices();

      expect(seen.method, 'GET');
      expect(seen.url.toString(), 'http://hub.test:3000/api/devices');
      expect(seen.headers['Accept'], 'application/json');
    });

    test('keeps a path prefix on the configured base URL', () async {
      late Uri seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test/hub/'),
        httpClient: MockClient((request) async {
          seen = request.url;
          return jsonResponse(devicesBody());
        }),
      );

      await client.fetchDevices();

      expect(seen.toString(), 'http://hub.test/hub/api/devices');
    });

    test('a Hub error body becomes a server exception with its code', () async {
      final hub = FakeHub()
        ..respond('/api/devices', {'error': 'Tuya is unavailable', 'code': 'UPSTREAM_ERROR'}, 502);

      await expectLater(
        hub.apiClient().fetchDevices(),
        throwsA(
          hubError(HubApiErrorKind.server, statusCode: 502, code: 'UPSTREAM_ERROR')
              .having((e) => e.message, 'message', 'Tuya is unavailable'),
        ),
      );
    });

    test('the list endpoint\'s 500 has no code and is still a server exception', () async {
      final hub = FakeHub()..respond('/api/devices', {'error': 'Internal error'}, 500);

      await expectLater(
        hub.apiClient().fetchDevices(),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 500)),
      );
    });

    test('a non-JSON error body still yields a server exception', () async {
      final hub = FakeHub()
        ..on('/api/devices', () async => http.Response('<html>Bad gateway</html>', 502));

      await expectLater(
        hub.apiClient().fetchDevices(),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 502)),
      );
    });

    test('a 200 that is not JSON is a parse exception', () async {
      final hub = FakeHub()..on('/api/devices', () async => http.Response('hello', 200));

      await expectLater(
        hub.apiClient().fetchDevices(),
        throwsA(hubError(HubApiErrorKind.parse, statusCode: 200)),
      );
    });

    test('a 200 whose "devices" is not a list is a parse exception', () async {
      final hub = FakeHub()..respond('/api/devices', {'devices': 'nope'});

      await expectLater(
        hub.apiClient().fetchDevices(),
        throwsA(hubError(HubApiErrorKind.parse)),
      );
    });

    test('a device entry without an id is a parse exception', () async {
      final hub = FakeHub()
        ..respond('/api/devices', {
          'devices': [
            {'name': 'no id'},
          ],
        });

      await expectLater(
        hub.apiClient().fetchDevices(),
        throwsA(hubError(HubApiErrorKind.parse)),
      );
    });

    test('a connection failure is a network exception', () async {
      final hub = FakeHub()..failNetwork('/api/devices');

      await expectLater(
        hub.apiClient().fetchDevices(),
        throwsA(hubError(HubApiErrorKind.network)),
      );
    });

    test('no answer within the timeout is a timeout exception', () async {
      final hub = FakeHub()..on('/api/devices', () => Completer<http.Response>().future);

      await expectLater(
        hub.apiClient(timeout: const Duration(milliseconds: 20)).fetchDevices(),
        throwsA(hubError(HubApiErrorKind.timeout)),
      );
    });
  });

  group('fetchCapabilities', () {
    test('requests the device\'s capabilities and parses them', () async {
      final hub = FakeHub()
        ..respond('/api/devices/$switchDeviceId/capabilities', switchCapabilitiesBody());

      final capabilities = await hub.apiClient().fetchCapabilities(switchDeviceId);

      expect(hub.requests, ['/api/devices/$switchDeviceId/capabilities']);
      expect(capabilities.id, switchDeviceId);
      expect(capabilities.commands.map((c) => c.code), ['switch_1', 'countdown_1', 'mode']);
      expect(capabilities.commands[1].constraintSummary, '0–86400 s');
    });

    test('an unknown device is a server exception with DEVICE_NOT_FOUND', () async {
      final hub = FakeHub()
        ..respond(
          '/api/devices/tuya:nope/capabilities',
          {'error': 'Device not found', 'code': 'DEVICE_NOT_FOUND', 'id': 'tuya:nope'},
          404,
        );

      await expectLater(
        hub.apiClient().fetchCapabilities('tuya:nope'),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 404, code: 'DEVICE_NOT_FOUND')),
      );
    });

    test('a body without "capabilities" is a parse exception', () async {
      final hub = FakeHub()..respond('/api/devices/tuya:x/capabilities', {'id': 'tuya:x'});

      await expectLater(
        hub.apiClient().fetchCapabilities('tuya:x'),
        throwsA(hubError(HubApiErrorKind.parse)),
      );
    });
  });

  group('close', () {
    test('leaves a client it was given open, and can close its own', () {
      final given = _SpyClient();
      HubApiClient(baseUrl: Uri.parse('http://hub.test:3000'), httpClient: given).close();

      expect(given.closed, isFalse);
      // Creating and closing an owned client must simply not throw.
      HubApiClient(baseUrl: Uri.parse('http://hub.test:3000')).close();
    });
  });
}

class _SpyClient extends http.BaseClient {
  bool closed = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    throw UnimplementedError('not used in this test');
  }

  @override
  void close() {
    closed = true;
  }
}
