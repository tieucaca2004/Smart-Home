import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:tieu_home/data/hub_api_client.dart';
import 'package:tieu_home/data/hub_api_exception.dart';

/// F-05: `executeScene` gets its own, longer timeout; every other request
/// (device calls included) keeps the short one. Uses a [MockClient] directly.

const _shortTimeout = Duration(milliseconds: 30);
const _sceneTimeout = Duration(milliseconds: 400);
const _delay = Duration(milliseconds: 120); // > short, < scene

http.Response _json(Object body) => http.Response(
      jsonEncode(body),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

const _sceneResult = {
  'sceneId': 'scene-1',
  'sceneName': 'Tắt hết',
  'success': true,
  'status': 'success',
  'results': [
    {
      'deviceId': 'd1',
      'functionCode': 'switch_1',
      'value': false,
      'success': true,
      'status': 'success',
      'verifiedAfterRetry': true,
    },
  ],
};

/// Answers every request after [delay], recording the paths it saw.
HubApiClient _slowHub(Duration delay, List<String> seen, {Duration? scene}) {
  final mock = MockClient((request) async {
    seen.add('${request.method} ${request.url.path}');
    await Future<void>.delayed(delay);
    if (request.url.path.endsWith('/execute')) return _json(_sceneResult);
    if (request.url.path.endsWith('/commands')) {
      return _json({'id': 'd1', 'code': 'switch_1', 'value': true, 'result': true});
    }
    return _json({'devices': <Object>[]});
  });
  return HubApiClient(
    baseUrl: Uri.parse('http://hub.test:3000'),
    httpClient: mock,
    timeout: _shortTimeout,
    sceneExecuteTimeout: scene ?? _sceneTimeout,
  );
}

TypeMatcher<HubApiException> _timeout() =>
    isA<HubApiException>().having((e) => e.kind, 'kind', HubApiErrorKind.timeout);

void main() {
  test('defaults: 10 s for ordinary requests, 120 s for executeScene', () {
    final client = HubApiClient(baseUrl: Uri.parse('http://hub.test:3000'));

    expect(client.timeout, const Duration(seconds: 10));
    expect(client.sceneExecuteTimeout, const Duration(seconds: 120));
  });

  test('executeScene tolerates a response slower than the ordinary timeout', () async {
    final seen = <String>[];
    final client = _slowHub(_delay, seen);

    final result = await client.executeScene('scene-1');

    expect(result.success, isTrue);
    expect(seen, ['POST /api/scenes/scene-1/execute']);
  });

  test('the same delay still times out on device calls (they keep the ordinary timeout)', () async {
    final seen = <String>[];
    final client = _slowHub(_delay, seen);

    await expectLater(client.fetchDevices(), throwsA(_timeout()));
    await expectLater(
      client.sendCommand('d1', code: 'switch_1', value: true),
      throwsA(_timeout()),
    );
  });

  test('a scene slower than sceneExecuteTimeout is a timeout using the effective (scene) timeout in its message', () async {
    final seen = <String>[];
    final client = _slowHub(
      const Duration(milliseconds: 1500),
      seen,
      scene: const Duration(seconds: 1),
    );

    await expectLater(
      client.executeScene('scene-1'),
      throwsA(
        _timeout().having((e) => e.message, 'message', allOf(contains('within 1s'), contains('/execute'))),
      ),
    );
  });

  test('a device-call timeout message still reports the ordinary timeout', () async {
    final hangs = MockClient((request) => Completer<http.Response>().future);
    final client = HubApiClient(
      baseUrl: Uri.parse('http://hub.test:3000'),
      httpClient: hangs,
      timeout: const Duration(seconds: 1),
      sceneExecuteTimeout: const Duration(seconds: 5),
    );

    await expectLater(
      client.fetchDevices(),
      throwsA(_timeout().having((e) => e.message, 'message', contains('within 1s'))),
    );
  });
}
