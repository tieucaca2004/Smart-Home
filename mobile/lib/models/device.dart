import 'json_helpers.dart';

/// Whether a device is reachable right now, as far as the Hub knows.
enum OnlineState { online, offline, unknown }

/// Shown when the Hub does not say which protocol a device uses.
const String unknownProtocol = 'unknown';

/// One entry of `GET /api/devices`.
///
/// Protocol-neutral on purpose: [protocol] is whatever the Hub says (any
/// adapter it has now or later: Matter, Zigbee, MQTT, IR, RF, ...) and the UI
/// never branches on it. [category] is passed through exactly as the Hub
/// reports it.
///
/// The Hub lists a device even when looking up its details failed; in that
/// case only the identity fields and [error] are present, and [name],
/// [category] and [online] are null.
class Device {
  const Device({
    required this.id,
    required this.nativeId,
    required this.protocol,
    this.name,
    this.category,
    this.online,
    this.error,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    final id = requiredString(json, 'id');
    return Device(
      id: id,
      nativeId: optionalString(json['nativeId']) ?? id,
      protocol: optionalString(json['protocol']) ?? unknownProtocol,
      name: optionalString(json['name']),
      category: optionalString(json['category']),
      online: optionalBool(json['online']),
      error: optionalString(json['error']),
    );
  }

  /// The Hub's id for the device: opaque, used unchanged in every Hub URL.
  final String id;

  /// The id within its own protocol, as the Hub reports it (falls back to [id]).
  final String nativeId;

  /// Which protocol/source the Hub reached the device through.
  final String protocol;

  final String? name;
  final String? category;

  /// null = the Hub did not say.
  final bool? online;

  /// Set when the Hub could not fetch this device's details.
  final String? error;

  /// A name that is always safe to show.
  String get displayName => name ?? nativeId;

  OnlineState get onlineState => switch (online) {
        true => OnlineState.online,
        false => OnlineState.offline,
        null => OnlineState.unknown,
      };
}
