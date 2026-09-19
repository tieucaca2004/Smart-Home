import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/device.dart';
import '../models/device_capabilities.dart';
import '../models/json_helpers.dart';
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

  /// Releases the underlying HTTP client, unless it was supplied by the caller.
  void close() {
    if (_ownsClient) _client.close();
  }

  Uri _uri(List<String> segments) {
    final prefix = _baseUrl.pathSegments.where((s) => s.isNotEmpty);
    return _baseUrl.replace(pathSegments: [...prefix, ...segments]);
  }

  Future<Map<String, dynamic>> _getJson(List<String> segments) async {
    final uri = _uri(segments);
    final response = await _send(uri);
    return _decode(response, uri);
  }

  Future<http.Response> _send(Uri uri) async {
    try {
      return await _client
          .get(uri, headers: const {'Accept': 'application/json'})
          .timeout(timeout);
    } on TimeoutException {
      throw HubApiException(
        HubApiErrorKind.timeout,
        'No response from $uri within ${timeout.inSeconds}s',
      );
    } on http.ClientException catch (e) {
      throw HubApiException(HubApiErrorKind.network, '${e.message} ($uri)');
    }
  }

  Map<String, dynamic> _decode(http.Response response, Uri uri) {
    final status = response.statusCode;
    final decoded = _tryDecode(response);

    if (status < 200 || status >= 300) {
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

    if (decoded is! Map<String, dynamic>) {
      throw HubApiException(
        HubApiErrorKind.parse,
        'Expected a JSON object from $uri',
        statusCode: status,
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
