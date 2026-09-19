import 'package:flutter/foundation.dart';

/// Where the Tiểu Home Hub lives.
///
/// The app only ever talks to the Hub's REST API. The address is a
/// compile-time setting so the same code works on an emulator, a simulator and
/// a real phone without editing source:
///
///     flutter run --dart-define=HUB_BASE_URL=http://192.168.1.50:3000
///
/// When `HUB_BASE_URL` is not provided, a development default is chosen per
/// platform (see [resolve]).
class HubConfig {
  const HubConfig(this.baseUrl);

  /// The Hub's default `PORT` (see the backend `src/server.js`).
  static const int defaultPort = 3000;

  /// Value of `--dart-define=HUB_BASE_URL=...`; empty when not provided.
  static const String _configured = String.fromEnvironment('HUB_BASE_URL');

  final Uri baseUrl;

  /// The configuration for the running app.
  factory HubConfig.current() =>
      HubConfig(resolve(configured: _configured, platform: defaultTargetPlatform));

  /// Pure resolution logic, separate from the environment so it can be tested.
  ///
  /// * [configured] non-empty: used as given (`http://` is assumed when no
  ///   scheme is written, so `192.168.1.50:3000` works). Must be http(s) with a host.
  /// * [configured] empty: development default for the platform.
  ///   * Android emulator: `http://10.0.2.2:3000` — the emulator's alias for the
  ///     development machine's loopback interface.
  ///   * iOS simulator (and anything else): `http://localhost:3000` — the
  ///     simulator shares the host's network.
  ///   A physical phone cannot use either; pass `HUB_BASE_URL` with the
  ///   computer's LAN address.
  ///
  /// Throws [FormatException] (message in Vietnamese, shown to the developer)
  /// when [configured] is not a usable URL.
  static Uri resolve({
    required String configured,
    required TargetPlatform platform,
  }) {
    final trimmed = configured.trim();
    if (trimmed.isEmpty) {
      final host = platform == TargetPlatform.android ? '10.0.2.2' : 'localhost';
      return Uri(scheme: 'http', host: host, port: defaultPort);
    }

    final withScheme = trimmed.contains('://') ? trimmed : 'http://$trimmed';
    final uri = Uri.tryParse(withScheme);
    final isHttp = uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
    if (uri == null || !isHttp || uri.host.isEmpty) {
      throw FormatException(
        'HUB_BASE_URL không hợp lệ: "$configured". '
        'Ví dụ đúng: http://192.168.1.50:3000',
      );
    }
    return uri;
  }
}
