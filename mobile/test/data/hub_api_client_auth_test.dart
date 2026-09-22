import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:tieu_home/data/hub_api_client.dart';

/// Round C / F-04 (Founder-approved additive-only scope): proves the 7
/// required items from `.bangiao/task.md` §"Founder decision on Q-A" that
/// concern the Flutter client (items 5, 6, 7). No real Hub, no real device,
/// no real Tuya — a [MockClient] records the headers/requests it receives.

http.Response _json(Object body) => http.Response(
      jsonEncode(body),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

const _devicesBody = {'devices': <Object>[]};
const _sceneResult = {
  'sceneId': 'scene-1',
  'sceneName': 'Tắt hết',
  'success': true,
  'status': 'success',
  'results': <Object>[],
};

void main() {
  group('item 5: no apiToken configured -> unchanged behavior', () {
    test('default apiToken is empty (no --dart-define in this test run)', () {
      final client = HubApiClient(baseUrl: Uri.parse('http://hub.test:3000'));
      expect(client.apiToken, isEmpty);
    });

    test('GET request headers have no Authorization key, only Accept', () async {
      late http.Request seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        httpClient: MockClient((request) async {
          seen = request;
          return _json(_devicesBody);
        }),
      );

      await client.fetchDevices();

      expect(seen.headers.containsKey('Authorization'), isFalse);
      expect(seen.headers['Accept'], 'application/json');
    });

    test('POST request headers (sendCommand) have no Authorization key', () async {
      late http.Request seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        httpClient: MockClient((request) async {
          seen = request;
          return _json({'id': 'd1', 'code': 'switch_1', 'value': true, 'result': true});
        }),
      );

      await client.sendCommand('d1', code: 'switch_1', value: true);

      expect(seen.headers.containsKey('Authorization'), isFalse);
      expect(seen.headers['Content-Type'], 'application/json');
    });
  });

  group('item 6: apiToken configured -> sent on every request', () {
    const token = 'secret-token';

    test('GET fetchDevices sends Authorization: Bearer secret-token', () async {
      late http.Request seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        apiToken: token,
        httpClient: MockClient((request) async {
          seen = request;
          return _json(_devicesBody);
        }),
      );

      await client.fetchDevices();

      expect(seen.headers['Authorization'], 'Bearer $token');
    });

    test('POST sendCommand sends Authorization: Bearer secret-token', () async {
      late http.Request seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        apiToken: token,
        httpClient: MockClient((request) async {
          seen = request;
          return _json({'id': 'd1', 'code': 'switch_1', 'value': true, 'result': true});
        }),
      );

      await client.sendCommand('d1', code: 'switch_1', value: true);

      expect(seen.headers['Authorization'], 'Bearer $token');
    });

    test('PUT updateScene sends Authorization: Bearer secret-token', () async {
      late http.Request seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        apiToken: token,
        httpClient: MockClient((request) async {
          seen = request;
          return _json({
            'scene': {'id': 's1', 'name': 'S', 'icon': 'lightbulb', 'actions': <Object>[]},
          });
        }),
      );

      await client.updateScene('s1', name: 'S', icon: 'lightbulb', actions: const []);

      expect(seen.headers['Authorization'], 'Bearer $token');
    });

    test('DELETE deleteScene sends Authorization: Bearer secret-token', () async {
      late http.Request seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        apiToken: token,
        httpClient: MockClient((request) async {
          seen = request;
          return http.Response('', 204);
        }),
      );

      await client.deleteScene('s1');

      expect(seen.headers['Authorization'], 'Bearer $token');
    });

    test('POST executeScene sends Authorization: Bearer secret-token', () async {
      late http.Request seen;
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        apiToken: token,
        httpClient: MockClient((request) async {
          seen = request;
          return _json(_sceneResult);
        }),
      );

      final result = await client.executeScene('scene-1');

      expect(seen.headers['Authorization'], 'Bearer $token');
      expect(result.success, isTrue);
    });
  });

  group('item 7: F-05 sceneExecuteTimeout / timeout unchanged by apiToken', () {
    test('apiToken set, no explicit timeouts -> defaults are still 10s / 120s', () {
      final client = HubApiClient(
        baseUrl: Uri.parse('http://hub.test:3000'),
        apiToken: 'secret-token',
      );

      expect(client.timeout, const Duration(seconds: 10));
      expect(client.sceneExecuteTimeout, const Duration(seconds: 120));
    });
  });
}
