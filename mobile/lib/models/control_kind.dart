import 'device_capabilities.dart';

/// What kind of control the app can offer for a command capability.
///
/// This is the single place that maps the Hub's capability `type` strings
/// (currently passed through in the source protocol's vocabulary) to the
/// app's own vocabulary. UI code switches on [ControlKind] and never looks at
/// `type` or at any protocol name.
enum ControlKind {
  /// An on/off value: rendered as a switch.
  toggle,

  /// Anything else (numbers, enums, ...): listed, but not controllable yet.
  unsupported,
}

/// The control kind for [function].
ControlKind controlKindOf(DeviceFunction function) {
  return switch (function.type.toLowerCase()) {
    'boolean' || 'bool' => ControlKind.toggle,
    _ => ControlKind.unsupported,
  };
}
