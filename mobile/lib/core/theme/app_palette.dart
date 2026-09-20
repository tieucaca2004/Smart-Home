import 'package:flutter/material.dart';

/// The colors Material's [ColorScheme] has no role for: "online" green, a
/// muted "offline" red and a "needs attention" amber, each with a soft
/// container and a text color that reads on it.
///
/// They are subtle on purpose (no neon): a status is a small dot and a quiet
/// label, never a loud block of color.
///
/// Read them with [AppPalette.of]. It falls back to the matching built-in set
/// when the theme has no [AppPalette] (a bare `MaterialApp`, as in widget
/// tests), so a widget never fails for lack of one.
@immutable
class AppPalette extends ThemeExtension<AppPalette> {
  const AppPalette({
    required this.success,
    required this.successContainer,
    required this.onSuccessContainer,
    required this.offline,
    required this.offlineContainer,
    required this.onOfflineContainer,
    required this.warning,
    required this.warningContainer,
    required this.onWarningContainer,
  });

  /// Online: dot and icon color.
  final Color success;
  final Color successContainer;
  final Color onSuccessContainer;

  /// Offline: a muted red, softer than the error color.
  final Color offline;
  final Color offlineContainer;
  final Color onOfflineContainer;

  /// Needs attention but nothing has failed (a command the device did not confirm).
  final Color warning;
  final Color warningContainer;
  final Color onWarningContainer;

  static const AppPalette light = AppPalette(
    success: Color(0xFF2F9E6E),
    successContainer: Color(0xFFE2F3EA),
    onSuccessContainer: Color(0xFF1B6F49),
    offline: Color(0xFFB4555A),
    offlineContainer: Color(0xFFF6E6E7),
    onOfflineContainer: Color(0xFF8A3A3F),
    warning: Color(0xFFB7791F),
    warningContainer: Color(0xFFFBF0DC),
    onWarningContainer: Color(0xFF7A5010),
  );

  static const AppPalette dark = AppPalette(
    success: Color(0xFF58C08F),
    successContainer: Color(0xFF17342A),
    onSuccessContainer: Color(0xFF9BE3BF),
    offline: Color(0xFFE58A8E),
    offlineContainer: Color(0xFF3B2325),
    onOfflineContainer: Color(0xFFF2B5B7),
    warning: Color(0xFFE0B04F),
    warningContainer: Color(0xFF3A2F15),
    onWarningContainer: Color(0xFFF2D591),
  );

  /// The palette of the current theme, or the built-in one for its brightness.
  static AppPalette of(BuildContext context) {
    final theme = Theme.of(context);
    return theme.extension<AppPalette>() ??
        (theme.brightness == Brightness.dark ? dark : light);
  }

  @override
  AppPalette copyWith({
    Color? success,
    Color? successContainer,
    Color? onSuccessContainer,
    Color? offline,
    Color? offlineContainer,
    Color? onOfflineContainer,
    Color? warning,
    Color? warningContainer,
    Color? onWarningContainer,
  }) {
    return AppPalette(
      success: success ?? this.success,
      successContainer: successContainer ?? this.successContainer,
      onSuccessContainer: onSuccessContainer ?? this.onSuccessContainer,
      offline: offline ?? this.offline,
      offlineContainer: offlineContainer ?? this.offlineContainer,
      onOfflineContainer: onOfflineContainer ?? this.onOfflineContainer,
      warning: warning ?? this.warning,
      warningContainer: warningContainer ?? this.warningContainer,
      onWarningContainer: onWarningContainer ?? this.onWarningContainer,
    );
  }

  @override
  AppPalette lerp(ThemeExtension<AppPalette>? other, double t) {
    if (other is! AppPalette) return this;
    return AppPalette(
      success: Color.lerp(success, other.success, t)!,
      successContainer: Color.lerp(successContainer, other.successContainer, t)!,
      onSuccessContainer: Color.lerp(onSuccessContainer, other.onSuccessContainer, t)!,
      offline: Color.lerp(offline, other.offline, t)!,
      offlineContainer: Color.lerp(offlineContainer, other.offlineContainer, t)!,
      onOfflineContainer: Color.lerp(onOfflineContainer, other.onOfflineContainer, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      warningContainer: Color.lerp(warningContainer, other.warningContainer, t)!,
      onWarningContainer: Color.lerp(onWarningContainer, other.onWarningContainer, t)!,
    );
  }
}
