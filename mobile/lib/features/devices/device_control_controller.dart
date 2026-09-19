import 'package:flutter/foundation.dart';

import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/device_status.dart';

/// How the last command for one control ended.
sealed class ControlOutcome {
  const ControlOutcome();
}

/// The Hub accepted the command AND the device's status now shows the value.
final class ControlConfirmed extends ControlOutcome {
  const ControlConfirmed();
}

/// The Hub accepted the command, but the app could not confirm the effect:
/// either the status could not be read back ([statusError] is set), or the
/// device still reports its old value (`statusError == null`). The control
/// then shows what the device reports, never the value that was asked for.
final class ControlUnconfirmed extends ControlOutcome {
  const ControlUnconfirmed([this.statusError]);

  final HubApiException? statusError;
}

/// The command was rejected or never reached the Hub; nothing is claimed.
final class ControlFailed extends ControlOutcome {
  const ControlFailed(this.error);

  final HubApiException error;
}

/// State and behavior behind the controls of one device.
///
/// It owns the last status read from the Hub and, per command code, whether a
/// command is pending and how the last one ended. Rules:
///
/// * The displayed value always comes from a status read, never from the value
///   the user asked for, so a failed or ignored command cannot look like a
///   success.
/// * Only the code with a command in flight is locked ([isPending]); other
///   codes stay usable.
/// * After the Hub accepts a command the status is read back (a few times, as
///   some clouds report the new value a moment late) and the outcome says
///   whether the device confirmed it.
class DeviceControlController extends ChangeNotifier {
  DeviceControlController({
    required HubApiClient client,
    required this.deviceId,
    this.confirmDelay = const Duration(milliseconds: 700),
    this.confirmAttempts = 3,
  })  : _client = client,
        assert(confirmAttempts >= 1, 'At least one status read is needed');

  final HubApiClient _client;
  final String deviceId;

  /// Wait between status reads while the device has not yet reported the new value.
  final Duration confirmDelay;

  /// Maximum status reads after a command before giving up on confirmation.
  final int confirmAttempts;

  DeviceStatus? _status;
  HubApiException? _statusError;
  bool _readingStatus = false;
  int _statusGeneration = 0;
  bool _disposed = false;
  final Set<String> _pending = <String>{};
  final Map<String, ControlOutcome> _outcomes = <String, ControlOutcome>{};

  /// The last status successfully read; null until the first read succeeds.
  DeviceStatus? get status => _status;

  /// Why the most recent explicit status read failed, if it did.
  HubApiException? get statusError => _statusError;

  /// True while [loadStatus] is running.
  bool get isReadingStatus => _readingStatus;

  /// The device-reported value of [code], or null when unknown.
  Object? valueOf(String code) => _status?[code];

  /// Whether a command for [code] is in flight.
  bool isPending(String code) => _pending.contains(code);

  /// How the last command for [code] ended; null if none yet (or one is pending).
  ControlOutcome? outcomeOf(String code) => _outcomes[code];

  /// Reads the status from the Hub. A failure keeps the previous status so
  /// the controls do not lose what was already known.
  Future<void> loadStatus() async {
    final generation = ++_statusGeneration;
    _readingStatus = true;
    _emit();

    final result = await _readStatus();

    if (_disposed || generation != _statusGeneration) return;
    _readingStatus = false;
    if (result.status != null) {
      _status = result.status;
      _statusError = null;
    } else {
      _statusError = result.error;
    }
    _emit();
  }

  /// Sends `{code, value}` to the Hub, then reads the status back.
  ///
  /// Ignored while a command for the same [code] is already pending.
  Future<void> setValue(String code, Object? value) async {
    if (_pending.contains(code)) return;
    _pending.add(code);
    _outcomes.remove(code);
    _emit();

    final outcome = await _execute(code, value);

    _pending.remove(code);
    _outcomes[code] = outcome;
    _emit();
  }

  Future<ControlOutcome> _execute(String code, Object? value) async {
    try {
      await _client.sendCommand(deviceId, code: code, value: value);
    } on HubApiException catch (e) {
      return ControlFailed(e);
    } catch (e) {
      return ControlFailed(HubApiException(HubApiErrorKind.unexpected, e.toString()));
    }
    return _confirm(code, value);
  }

  /// The Hub accepted the command; find out what the device really did.
  Future<ControlOutcome> _confirm(String code, Object? requested) async {
    HubApiException? lastError;
    for (var attempt = 0; attempt < confirmAttempts; attempt++) {
      if (attempt > 0) await Future<void>.delayed(confirmDelay);
      final result = await _readStatus();
      final status = result.status;
      if (status == null) {
        lastError = result.error;
        continue;
      }
      lastError = null;
      _status = status;
      _statusError = null;
      if (status[code] == requested) return const ControlConfirmed();
    }
    return ControlUnconfirmed(lastError);
  }

  Future<({DeviceStatus? status, HubApiException? error})> _readStatus() async {
    try {
      return (status: await _client.fetchStatus(deviceId), error: null);
    } on HubApiException catch (e) {
      return (status: null, error: e);
    } catch (e) {
      return (
        status: null,
        error: HubApiException(HubApiErrorKind.unexpected, e.toString()),
      );
    }
  }

  void _emit() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
