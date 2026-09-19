import 'device.dart' show unknownProtocol;
import 'json_helpers.dart';

/// One command or status the Hub reports for a device
/// (an element of `commands[]` / `statuses[]` in `GET /api/devices/:id/capabilities`).
///
/// [type] and [values] are passed through in the protocol's own vocabulary;
/// the Hub does not map them to a neutral one yet.
class DeviceFunction {
  const DeviceFunction({
    required this.code,
    required this.type,
    this.name,
    this.description,
    this.values,
  });

  factory DeviceFunction.fromJson(Map<String, dynamic> json) {
    final values = json['values'];
    return DeviceFunction(
      code: requiredString(json, 'code'),
      type: optionalString(json['type']) ?? 'unknown',
      name: optionalString(json['name']),
      description: optionalString(json['desc']),
      values: values is Map<String, dynamic> ? values : null,
    );
  }

  final String code;
  final String type;
  final String? name;
  final String? description;

  /// Constraint object (`range`, `min`/`max`/`unit`, ...). Empty = no
  /// constraints; null = the Hub could not parse it.
  final Map<String, dynamic>? values;

  /// A short human-readable form of [values], or null when there is nothing
  /// useful to show. Understands the two constraint shapes that are common
  /// across protocols: a list of allowed options (`range`), and a numeric
  /// span (`min`/`max`, with an optional `unit`).
  String? get constraintSummary {
    final v = values;
    if (v == null) return null;

    final range = v['range'];
    if (range is List && range.isNotEmpty) return range.join(' / ');

    final min = v['min'];
    final max = v['max'];
    if (min is num && max is num) {
      final unit = optionalString(v['unit']);
      final span = '${_formatNumber(min)}–${_formatNumber(max)}';
      return unit == null ? span : '$span $unit';
    }
    return null;
  }
}

String _formatNumber(num n) => n == n.truncate() ? n.truncate().toString() : n.toString();

/// The `capabilities` object of `GET /api/devices/:id/capabilities`.
class DeviceCapabilities {
  const DeviceCapabilities({
    required this.id,
    required this.protocol,
    required this.nativeId,
    this.name,
    this.category,
    this.online,
    this.commands = const <DeviceFunction>[],
    this.statuses = const <DeviceFunction>[],
  });

  factory DeviceCapabilities.fromJson(Map<String, dynamic> json) {
    final id = requiredString(json, 'id');
    return DeviceCapabilities(
      id: id,
      protocol: optionalString(json['protocol']) ?? unknownProtocol,
      nativeId: optionalString(json['nativeId']) ?? id,
      name: optionalString(json['name']),
      category: optionalString(json['category']),
      online: optionalBool(json['online']),
      commands: _functions(json['commands'], 'commands'),
      statuses: _functions(json['statuses'], 'statuses'),
    );
  }

  final String id;
  final String protocol;
  final String nativeId;
  final String? name;
  final String? category;
  final bool? online;

  /// Codes the device accepts via `POST /api/devices/:id/commands`.
  final List<DeviceFunction> commands;

  /// Codes the device reports via `GET /api/devices/:id/status`.
  final List<DeviceFunction> statuses;
}

List<DeviceFunction> _functions(Object? value, String field) {
  if (value == null) return const <DeviceFunction>[];
  if (value is! List) throw FormatException('Expected "$field" to be a list');
  return <DeviceFunction>[
    for (final item in value) DeviceFunction.fromJson(asJsonObject(item, '$field entry')),
  ];
}
