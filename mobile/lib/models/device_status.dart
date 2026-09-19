import 'json_helpers.dart';

/// The `status` array of `GET /api/devices/:id/status`: the values the device
/// last reported, keyed by code. Values are passed through as decoded JSON
/// (`bool`, `num`, `String`, ...); the meaning of a code is the protocol's.
class DeviceStatus {
  const DeviceStatus(this.values);

  factory DeviceStatus.fromJson(Map<String, dynamic> json) {
    final list = json['status'];
    if (list is! List) {
      throw const FormatException('Expected "status" to be a list');
    }
    final values = <String, Object?>{};
    for (final item in list) {
      final entry = asJsonObject(item, 'status entry');
      values[requiredString(entry, 'code')] = entry['value'];
    }
    return DeviceStatus(values);
  }

  final Map<String, Object?> values;

  /// The reported value of [code]; null when the device did not report it
  /// (which is also what an explicit JSON null looks like).
  Object? operator [](String code) => values[code];
}

/// The Hub's answer to `POST /api/devices/:id/commands`.
///
/// A 2xx only means the Hub (and the vendor cloud behind it) accepted the
/// command. It does not prove the device changed: read the status back.
class CommandReceipt {
  const CommandReceipt({required this.code, required this.value, this.result});

  /// Lenient on purpose: the command may already have been carried out by the
  /// time this is parsed, so a missing field must not turn success into an error.
  factory CommandReceipt.fromJson(Map<String, dynamic> json) {
    return CommandReceipt(
      code: optionalString(json['code']) ?? '',
      value: json['value'],
      result: json['result'],
    );
  }

  /// Echo of the command code the Hub executed.
  final String code;

  /// Echo of the value the Hub sent.
  final Object? value;

  /// Whatever the protocol adapter returned (opaque).
  final Object? result;
}
