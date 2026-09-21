import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/automation.dart';
import '../models/device.dart';
import '../models/device_capabilities.dart';
import '../models/device_status.dart';
import '../models/json_helpers.dart';
import '../models/scene.dart';
import 'hub_api_exception.dart';

/// Minimal client for the Tiểu Home Hub REST API.
///
/// It only knows the Hub's own, protocol-neutral endpoints; it never talks to
/// a device vendor's cloud. Every failure surfaces as a [HubApiException].
class HubApiClient {
  HubApiClient({
    required Uri baseUrl,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 10),
  })  : _baseUrl = baseUrl,
        _client = httpClient ?? http.Client(),
        _ownsClient = httpClient == null;

  final Uri _baseUrl;
  final http.Client _client;
  final bool _ownsClient;

  /// How long to wait for the Hub before giving up.
  final Duration timeout;

  /// The Hub address this client talks to (useful for error messages).
  Uri get baseUrl => _baseUrl;

  /// `GET /api/devices`
  Future<List<Device>> fetchDevices() async {
    final body = await _getJson(const ['api', 'devices']);
    return _parse('/api/devices', () {
      final list = body['devices'];
      if (list is! List) {
        throw const FormatException('Expected "devices" to be a list');
      }
      return <Device>[
        for (final item in list) Device.fromJson(asJsonObject(item, 'device entry')),
      ];
    });
  }

  /// `GET /api/devices/:id/capabilities`
  Future<DeviceCapabilities> fetchCapabilities(String deviceId) async {
    final body = await _getJson(['api', 'devices', deviceId, 'capabilities']);
    return _parse('/api/devices/:id/capabilities', () {
      return DeviceCapabilities.fromJson(asJsonObject(body['capabilities'], '"capabilities"'));
    });
  }

  /// `GET /api/devices/:id/status`
  Future<DeviceStatus> fetchStatus(String deviceId) async {
    final body = await _getJson(['api', 'devices', deviceId, 'status']);
    return _parse('/api/devices/:id/status', () => DeviceStatus.fromJson(body));
  }

  /// `POST /api/devices/:id/commands` with the Hub's body `{ "code", "value" }`.
  ///
  /// Completing normally means the Hub accepted the command, not that the
  /// device has changed; call [fetchStatus] to see the real state.
  Future<CommandReceipt> sendCommand(
    String deviceId, {
    required String code,
    required Object? value,
  }) async {
    final body = await _postJson(
      ['api', 'devices', deviceId, 'commands'],
      {'code': code, 'value': value},
    );
    return _parse('/api/devices/:id/commands', () => CommandReceipt.fromJson(body));
  }

  // ---------------------------------------------------------------------
  // Scenes (Sprint 5)
  // ---------------------------------------------------------------------

  /// `GET /api/scenes`
  Future<List<Scene>> fetchScenes() async {
    final body = await _getJson(const ['api', 'scenes']);
    return _parse('/api/scenes', () {
      final list = body['scenes'];
      if (list is! List) {
        throw const FormatException('Expected "scenes" to be a list');
      }
      return <Scene>[for (final item in list) Scene.fromJson(asJsonObject(item, 'scene entry'))];
    });
  }

  /// `GET /api/scenes/:id`
  Future<Scene> fetchScene(String id) async {
    final body = await _getJson(['api', 'scenes', id]);
    return _parse('/api/scenes/:id', () => Scene.fromJson(asJsonObject(body['scene'], '"scene"')));
  }

  /// `POST /api/scenes`
  Future<Scene> createScene({
    required String name,
    required String icon,
    required List<SceneAction> actions,
  }) async {
    final body = await _postJson(const ['api', 'scenes'], _scenePayload(name: name, icon: icon, actions: actions));
    return _parse('/api/scenes', () => Scene.fromJson(asJsonObject(body['scene'], '"scene"')));
  }

  /// `PUT /api/scenes/:id` (full replace).
  Future<Scene> updateScene(
    String id, {
    required String name,
    required String icon,
    required List<SceneAction> actions,
  }) async {
    final body = await _putJson(
      ['api', 'scenes', id],
      _scenePayload(name: name, icon: icon, actions: actions),
    );
    return _parse('/api/scenes/:id', () => Scene.fromJson(asJsonObject(body['scene'], '"scene"')));
  }

  /// `DELETE /api/scenes/:id`
  Future<void> deleteScene(String id) => _deleteVoid(['api', 'scenes', id]);

  /// `POST /api/scenes/:id/execute`. Completing normally means the Hub ran
  /// every action; [SceneExecutionResult.success] says whether every one of
  /// them was confirmed — a 200 response is not itself a success signal.
  Future<SceneExecutionResult> executeScene(String id) async {
    final body = await _postJson(['api', 'scenes', id, 'execute'], const <String, Object?>{});
    return _parse('/api/scenes/:id/execute', () => SceneExecutionResult.fromJson(body));
  }

  Map<String, Object?> _scenePayload({
    required String name,
    required String icon,
    required List<SceneAction> actions,
  }) {
    return {'name': name, 'icon': icon, 'actions': [for (final a in actions) a.toJson()]};
  }

  // ---------------------------------------------------------------------
  // Automations (Sprint 5)
  // ---------------------------------------------------------------------

  /// `GET /api/automations`
  Future<List<Automation>> fetchAutomations() async {
    final body = await _getJson(const ['api', 'automations']);
    return _parse('/api/automations', () {
      final list = body['automations'];
      if (list is! List) {
        throw const FormatException('Expected "automations" to be a list');
      }
      return <Automation>[
        for (final item in list) Automation.fromJson(asJsonObject(item, 'automation entry')),
      ];
    });
  }

  /// `GET /api/automations/:id`
  Future<Automation> fetchAutomation(String id) async {
    final body = await _getJson(['api', 'automations', id]);
    return _parse(
      '/api/automations/:id',
      () => Automation.fromJson(asJsonObject(body['automation'], '"automation"')),
    );
  }

  /// `POST /api/automations`
  Future<Automation> createAutomation({
    required String name,
    required bool enabled,
    required AutomationTrigger trigger,
    required String sceneId,
  }) async {
    final body = await _postJson(
      const ['api', 'automations'],
      _automationPayload(name: name, enabled: enabled, trigger: trigger, sceneId: sceneId),
    );
    return _parse(
      '/api/automations',
      () => Automation.fromJson(asJsonObject(body['automation'], '"automation"')),
    );
  }

  /// `PUT /api/automations/:id` (full replace).
  Future<Automation> updateAutomation(
    String id, {
    required String name,
    required bool enabled,
    required AutomationTrigger trigger,
    required String sceneId,
  }) async {
    final body = await _putJson(
      ['api', 'automations', id],
      _automationPayload(name: name, enabled: enabled, trigger: trigger, sceneId: sceneId),
    );
    return _parse(
      '/api/automations/:id',
      () => Automation.fromJson(asJsonObject(body['automation'], '"automation"')),
    );
  }

  /// `DELETE /api/automations/:id`
  Future<void> deleteAutomation(String id) => _deleteVoid(['api', 'automations', id]);

  Map<String, Object?> _automationPayload({
    required String name,
    required bool enabled,
    required AutomationTrigger trigger,
    required String sceneId,
  }) {
    return {'name': name, 'enabled': enabled, 'trigger': trigger.toJson(), 'sceneId': sceneId};
  }

  /// Releases the underlying HTTP client, unless it was supplied by the caller.
  void close() {
    if (_ownsClient) _client.close();
  }

  Uri _uri(List<String> segments) {
    final prefix = _baseUrl.pathSegments.where((s) => s.isNotEmpty);
    return _baseUrl.replace(pathSegments: [...prefix, ...segments]);
  }

  Future<Map<String, dynamic>> _getJson(List<String> segments) => _requestJson(segments, method: 'GET');

  Future<Map<String, dynamic>> _postJson(List<String> segments, Object body) {
    return _requestJson(segments, method: 'POST', body: body);
  }

  Future<Map<String, dynamic>> _putJson(List<String> segments, Object body) {
    return _requestJson(segments, method: 'PUT', body: body);
  }

  Future<void> _deleteVoid(List<String> segments) async {
    final uri = _uri(segments);
    final response = await _send(uri, method: 'DELETE');
    _checkStatus(response, uri);
  }

  Future<Map<String, dynamic>> _requestJson(
    List<String> segments, {
    required String method,
    Object? body,
  }) async {
    final uri = _uri(segments);
    final response = await _send(uri, method: method, body: body);
    return _decode(response, uri);
  }

  Future<http.Response> _send(Uri uri, {required String method, Object? body}) async {
    final headers = <String, String>{
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
    };
    try {
      final encoded = body == null ? null : jsonEncode(body);
      final pending = switch (method) {
        'GET' => _client.get(uri, headers: headers),
        'POST' => _client.post(uri, headers: headers, body: encoded),
        'PUT' => _client.put(uri, headers: headers, body: encoded),
        'DELETE' => _client.delete(uri, headers: headers),
        _ => throw ArgumentError('Unsupported HTTP method: $method'),
      };
      return await pending.timeout(timeout);
    } on TimeoutException {
      throw HubApiException(
        HubApiErrorKind.timeout,
        'No response from $uri within ${timeout.inSeconds}s',
      );
    } on http.ClientException catch (e) {
      throw HubApiException(HubApiErrorKind.network, '${e.message} ($uri)');
    }
  }

  /// Throws when [response] is not 2xx; the Hub's own error taxonomy (`code`)
  /// is carried over when the body had one, exactly as [_decode] does.
  void _checkStatus(http.Response response, Uri uri) {
    final status = response.statusCode;
    if (status < 200 || status >= 300) {
      final decoded = _tryDecode(response);
      String? code;
      String? message;
      if (decoded is Map<String, dynamic>) {
        code = optionalString(decoded['code']);
        message = optionalString(decoded['error']);
      }
      throw HubApiException(
        HubApiErrorKind.server,
        message ?? 'HTTP $status from $uri',
        statusCode: status,
        code: code,
      );
    }
  }

  Map<String, dynamic> _decode(http.Response response, Uri uri) {
    _checkStatus(response, uri);
    final decoded = _tryDecode(response);
    if (decoded is! Map<String, dynamic>) {
      throw HubApiException(
        HubApiErrorKind.parse,
        'Expected a JSON object from $uri',
        statusCode: response.statusCode,
      );
    }
    return decoded;
  }

  Object? _tryDecode(http.Response response) {
    try {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      return null;
    }
  }

  T _parse<T>(String what, T Function() build) {
    try {
      return build();
    } on FormatException catch (e) {
      throw HubApiException(
        HubApiErrorKind.parse,
        'Unexpected response from $what: ${e.message}',
      );
    }
  }
}
