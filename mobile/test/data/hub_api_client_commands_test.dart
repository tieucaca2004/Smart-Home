import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:tieu_home/data/hub_api_exception.dart';

import '../support/fake_hub.dart';
import '../support/fixtures.dart';

TypeMatcher<HubApiException> hubError(HubApiErrorKind kind, {int? statusCode, String? code}) {
  return isA<HubApiException>()
      .having((e) => e.kind, 'kind', kind)
      .having((e) => e.statusCode, 'statusCode', statusCode)
      .having((e) => e.code, 'code', code);
}

const String commandsPath = '/api/devices/$switchDeviceId/commands';
const String statusPath = '/api/devices/$switchDeviceId/status';

void main() {
  group('sendCommand request construction', () {
    test('POSTs exactly {code, value} as JSON to /api/devices/:id/commands', () async {
      final hub = FakeHub()
        ..respondPost(commandsPath, {
          'id': switchDeviceId,
          'code': 'switch_1',
          'value': true,
          'result': true,
        });

      await hub.apiClient().sendCommand(switchDeviceId, code: 'switch_1', value: true);

      final request = hub.posts.single;
      expect(request.method, 'POST');
      expect(request.url.host, 'hub.test');
      expect(request.url.port, 3000);
      expect(Uri.decodeComponent(request.url.path), commandsPath);
      expect(request.headers['Content-Type'], startsWith('application/json'));
      expect(request.headers['Accept'], 'application/json');
      // The Hub's contract: no other fields, nothing renamed.
      expect(jsonDecode(request.body), {'code': 'switch_1', 'value': true});
    });

    test('sends value false (the Hub accepts it; it is not "missing")', () async {
      final hub = FakeHub()..respondPost(commandsPath, {'id': switchDeviceId, 'result': true});

      await hub.apiClient().sendCommand(switchDeviceId, code: 'switch_2', value: false);

      expect(jsonDecode(hub.posts.single.body), {'code': 'switch_2', 'value': false});
    });

    test('keeps the value type: numbers and strings are not stringified', () async {
      final hub = FakeHub()..respondPost(commandsPath, {'id': switchDeviceId, 'result': true});
      final client = hub.apiClient();

      await client.sendCommand(switchDeviceId, code: 'countdown_1', value: 30);
      await client.sendCommand(switchDeviceId, code: 'mode', value: 'cold');

      expect(jsonDecode(hub.posts[0].body), {'code': 'countdown_1', 'value': 30});
      expect(jsonDecode(hub.posts[1].body), {'code': 'mode', 'value': 'cold'});
    });

    test('does not send a GET, and uses no other endpoint', () async {
      final hub = FakeHub()..respondPost(commandsPath, {'id': switchDeviceId, 'result': true});

      await hub.apiClient().sendCommand(switchDeviceId, code: 'switch_1', value: true);

      expect(hub.calls, ['POST $commandsPath']);
    });
  });

  group('sendCommand outcome', () {
    test('a 200 becomes a receipt echoing the Hub answer', () async {
      final hub = FakeHub()
        ..respondPost(commandsPath, {
          'id': switchDeviceId,
          'code': 'switch_1',
          'value': true,
          'result': true,
        });

      final receipt = await hub
          .apiClient()
          .sendCommand(switchDeviceId, code: 'switch_1', value: true);

      expect(receipt.code, 'switch_1');
      expect(receipt.value, isTrue);
      expect(receipt.result, isTrue);
    });

    for (final (status, code) in [
      (409, 'DEVICE_OFFLINE'),
      (400, 'INVALID_COMMAND'),
      (404, 'DEVICE_NOT_FOUND'),
      (500, 'AUTH_ERROR'),
      (502, 'UPSTREAM_ERROR'),
    ]) {
      test('HTTP $status $code is a server exception carrying the code', () async {
        final hub = FakeHub()
          ..respondPost(
            commandsPath,
            {'error': 'Hub says no', 'code': code, 'id': switchDeviceId},
            status,
          );

        await expectLater(
          hub.apiClient().sendCommand(switchDeviceId, code: 'switch_1', value: true),
          throwsA(hubError(HubApiErrorKind.server, statusCode: status, code: code)),
        );
      });
    }

    test('a connection failure is a network exception', () async {
      final hub = FakeHub()..failNetworkPost(commandsPath);

      await expectLater(
        hub.apiClient().sendCommand(switchDeviceId, code: 'switch_1', value: true),
        throwsA(hubError(HubApiErrorKind.network)),
      );
    });

    test('no answer within the timeout is a timeout exception', () async {
      final hub = FakeHub()..onPost(commandsPath, (request) => Completer<http.Response>().future);

      await expectLater(
        hub
            .apiClient(timeout: const Duration(milliseconds: 20))
            .sendCommand(switchDeviceId, code: 'switch_1', value: true),
        throwsA(hubError(HubApiErrorKind.timeout)),
      );
    });

    test('a 200 that is not JSON is a parse exception', () async {
      final hub = FakeHub()..onPost(commandsPath, (request) async => http.Response('ok', 200));

      await expectLater(
        hub.apiClient().sendCommand(switchDeviceId, code: 'switch_1', value: true),
        throwsA(hubError(HubApiErrorKind.parse, statusCode: 200)),
      );
    });
  });

  group('fetchStatus', () {
    test('GETs /api/devices/:id/status and parses the reported values', () async {
      final hub = FakeHub()
        ..respond(statusPath, {
          'id': switchDeviceId,
          'status': [
            {'code': 'switch_1', 'value': true},
            {'code': 'switch_2', 'value': false},
          ],
        });

      final status = await hub.apiClient().fetchStatus(switchDeviceId);

      expect(hub.calls, ['GET $statusPath']);
      expect(status['switch_1'], isTrue);
      expect(status['switch_2'], isFalse);
      expect(status['switch_3'], isNull);
    });

    test('a body without a status list is a parse exception', () async {
      final hub = FakeHub()..respond(statusPath, {'id': switchDeviceId});

      await expectLater(
        hub.apiClient().fetchStatus(switchDeviceId),
        throwsA(hubError(HubApiErrorKind.parse)),
      );
    });

    test('an offline device is a server exception with DEVICE_OFFLINE', () async {
      final hub = FakeHub()
        ..respond(
          statusPath,
          {'error': 'device is offline', 'code': 'DEVICE_OFFLINE', 'id': switchDeviceId},
          409,
        );

      await expectLater(
        hub.apiClient().fetchStatus(switchDeviceId),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 409, code: 'DEVICE_OFFLINE')),
      );
    });

    test('a connection failure is a network exception', () async {
      final hub = FakeHub()..failNetwork(statusPath);

      await expectLater(
        hub.apiClient().fetchStatus(switchDeviceId),
        throwsA(hubError(HubApiErrorKind.network)),
      );
    });
  });
}
