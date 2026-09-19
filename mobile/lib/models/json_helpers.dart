/// Small helpers for reading the Hub's JSON defensively. They throw
/// [FormatException] on shape problems; the API client turns that into a
/// `HubApiException(parse)`.
library;

/// Returns [value] as a JSON object or throws.
Map<String, dynamic> asJsonObject(Object? value, String what) {
  if (value is Map<String, dynamic>) return value;
  throw FormatException('Expected $what to be a JSON object');
}

/// A non-empty string, or null when absent / empty / not a string.
String? optionalString(Object? value) {
  if (value is String && value.isNotEmpty) return value;
  return null;
}

/// A bool, or null when absent / not a bool (so "unknown" stays distinct from false).
bool? optionalBool(Object? value) => value is bool ? value : null;

/// A required non-empty string field, or throws.
String requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Missing or empty "$key"');
}
