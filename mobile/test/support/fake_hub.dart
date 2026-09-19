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
/// [MockClient]. Routes are matched on the request path only.
class FakeHub {
  final Map<String, Future<http.Response> Function()> _routes = {};

  /// Every request path seen so far, in order.
  final List<String> requests = [];

  /// Serves [body] as JSON with [status] for GET [path].
  void respond(String path, Object body, [int status = 200]) {
    _routes[path] = () async => jsonResponse(body, status);
  }

  /// Serves whatever [handler] produces for GET [path] (e.g. to delay it).
  void on(String path, Future<http.Response> Function() handler) {
    _routes[path] = handler;
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
