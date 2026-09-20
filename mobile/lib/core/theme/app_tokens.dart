/// Design tokens shared by every screen: one spacing scale, one radius scale
/// and one animation speed, so nothing picks its own numbers.
library;

/// The spacing scale (logical pixels). Screens compose gaps and padding from
/// these values only.
abstract final class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;

  /// Horizontal margin of a screen's content.
  static const double screen = 20;
}

/// The corner radius scale.
abstract final class AppRadius {
  /// Small elements: chips, badges' containers.
  static const double sm = 12;

  /// Icon containers, buttons.
  static const double md = 16;

  /// Cards.
  static const double lg = 20;

  /// Large hero surfaces.
  static const double xl = 28;
}

/// Animation timing.
abstract final class AppMotion {
  static const Duration fast = Duration(milliseconds: 180);
}
