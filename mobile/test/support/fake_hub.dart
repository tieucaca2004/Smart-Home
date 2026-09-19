import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:tieu_home/data/hub_api_client.dart';

/// A JSON response the way the Hub's Express server sends it (UTF-8).
http.Response jsonResponse(Object body, [int status = 200]) {
  return http.Response(
    jsonEncode(body),
    status,
    headers: const {'content-type': 'application/json; charset=utf-8'},
  );
}

/// An in-memory stand-in for the Hub's HTTP server, used through a
/// [MockClient]. Routes are matched on the request method (GET or POST) and path.
class FakeHub {
  final Map<String, Future<http.Response> Function()> _routes = {};

  final Map<String, Future<http.Response> Function(http.Request request)> _postRoutes = {};

  /// Every GET request path seen so far, in order.
  final List<String> requests = [];

  /// Every call in order, as `GET /path` or `POST /path` (GET and POST).
  final List<String> calls = [];

  /// Every POST received, so tests can check its headers and body.
  final List<http.Request> posts = [];

  /// Serves [body] as JSON with [status] for GET [path].
  void respond(String path, Object body, [int status = 200]) {
    _routes[path] = () async => jsonResponse(body, status);
  }

  /// Serves whatever [handler] produces for GET [path] (e.g. to delay it).
  void on(String path, Future<http.Response> Function() handler) {
    _routes[path] = handler;
  }

  /// Serves [body] as JSON with [status] for POST [path].
  void respondPost(String path, Object body, [int status = 200]) {
    _postRoutes[path] = (request) async => jsonResponse(body, status);
  }

  /// Serves whatever [handler] produces for POST [path].
  void onPost(String path, Future<http.Response> Function(http.Request request) handler) {
    _postRoutes[path] = handler;
  }

  /// Makes POST [path] fail as a network error would.
  void failNetworkPost(String path) {
    _postRoutes[path] = (request) async {
      throw http.ClientException('Connection refused');
    };
  }

  /// Serves `GET .../status` and `POST .../commands` for [id] from an in-memory
  /// device that behaves like a real one: accepted commands change its state,
  /// and the status route reports that state.
  FakeControllableDevice serveDevice(String id, Map<String, Object?> state) {
    final device = FakeControllableDevice(id, state);

    on('/api/devices/$id/status', () async {
      return jsonResponse({
        'id': id,
        'status': [
          for (final entry in device.state.entries) {'code': entry.key, 'value': entry.value},
        ],
      });
    });

    onPost('/api/devices/$id/commands', (request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      device.commands.add(body);
      final gate = device.gate;
      if (gate != null) await gate.future;
      if (!device.online) {
        return jsonResponse(
          {'error': 'device is offline', 'code': 'DEVICE_OFFLINE', 'id': id},
          409,
        );
      }
      if (device.applyCommands) device.state[body['code'] as String] = body['value'];
      return jsonResponse({
        'id': id,
        'code': body['code'],
        'value': body['value'],
        'result': true,
      });
    });
    return device;
  }

  /// Makes GET [path] fail as a network error would.
  void failNetwork(String path) {
    _routes[path] = () async {
      throw http.ClientException('Connection refused');
    };
  }

  /// A real [HubApiClient] wired to this fake Hub.
  HubApiClient apiClient({Duration timeout = const Duration(seconds: 10)}) {
    final mock = MockClient((request) async {
      final path = Uri.decodeComponent(request.url.path);
      calls.add('${request.method} $path');
      if (request.method == 'POST') {
        posts.add(request);
        final post = _postRoutes[path];
        if (post == null) return jsonResponse({'error': 'Not found'}, 404);
        return post(request);
      }
      requests.add(path);
      final handler = _routes[path];
      if (handler == null) {
        return jsonResponse({'error': 'Not found'}, 404);
      }
      return handler();
    });
    return HubApiClient(
      baseUrl: Uri.parse('http://hub.test:3000'),
      httpClient: mock,
      timeout: timeout,
    );
  }
}

/// A device that [FakeHub.serveDevice] keeps in memory.
class FakeControllableDevice {
  FakeControllableDevice(this.id, Map<String, Object?> state) : state = Map.of(state);

  final String id;

  /// What the device currently reports, by code.
  final Map<String, Object?> state;

  /// When false the Hub answers commands with `409 DEVICE_OFFLINE`.
  bool online = true;

  /// When false the Hub accepts commands (200) but the device does not change,
  /// like a command the physical device ignored.
  bool applyCommands = true;

  /// When set, command responses are held until it completes.
  Completer<void>? gate;

  /// The decoded JSON body of every command received, in order.
  final List<Map<String, dynamic>> commands = [];
}
