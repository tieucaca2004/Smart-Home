/// What kind of failure happened while calling the Hub.
enum HubApiErrorKind {
  /// Could not reach the Hub at all (wrong address, Hub down, no network).
  network,

  /// The Hub did not answer in time.
  timeout,

  /// The Hub answered with a non-2xx status (its own error taxonomy, e.g.
  /// `DEVICE_OFFLINE`, is in [HubApiException.code]).
  server,

  /// The Hub answered 2xx but the body was not the expected JSON shape.
  parse,

  /// Anything else; indicates a bug rather than an environment problem.
  unexpected,
}

/// The only exception type the data layer throws, so UI code has one thing to
/// handle. It carries facts, not user-facing text; the UI decides the wording.
class HubApiException implements Exception {
  const HubApiException(
    this.kind,
    this.message, {
    this.statusCode,
    this.code,
  });

  final HubApiErrorKind kind;

  /// Technical description (for logs and a small "detail" line in the UI).
  final String message;

  /// HTTP status, for [HubApiErrorKind.server].
  final int? statusCode;

  /// The Hub's normalized error code (`AUTH_ERROR`, `DEVICE_OFFLINE`, ...),
  /// when the error body had one.
  final String? code;

  @override
  String toString() {
    final parts = <String>[
      kind.name,
      if (statusCode != null) 'HTTP $statusCode',
      ?code,
    ];
    return 'HubApiException(${parts.join(', ')}): $message';
  }
}
