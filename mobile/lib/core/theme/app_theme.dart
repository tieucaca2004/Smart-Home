import 'package:flutter/material.dart';

import 'app_palette.dart';
import 'app_tokens.dart';

/// The app's look: "premium smart home", calm and light, built on Material 3
/// and Flutter's own components (no extra packages, no custom fonts).
///
/// | Role            | Light                | Dark                 |
/// |-----------------|----------------------|----------------------|
/// | primary         | deep teal `0F766E`   | soft teal `56C2B6`   |
/// | background      | cool off-white       | near-black green     |
/// | surface (cards) | white                | raised dark green    |
/// | text primary    | `16211F`             | `E6EEEC`             |
/// | text secondary  | `5C6B68`             | `9AACA9`             |
/// | divider         | `E2E8E6`             | `263533`             |
///
/// Success and offline colors live in [AppPalette]; spacing and radius scales
/// in `app_tokens.dart`.
abstract final class AppTheme {
  static const Color _seed = Color(0xFF0F766E);

  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final scheme = ColorScheme.fromSeed(seedColor: _seed, brightness: brightness).copyWith(
      primary: isDark ? const Color(0xFF56C2B6) : const Color(0xFF0F766E),
      onPrimary: isDark ? const Color(0xFF003733) : const Color(0xFFFFFFFF),
      primaryContainer: isDark ? const Color(0xFF14413D) : const Color(0xFFD7EFEB),
      onPrimaryContainer: isDark ? const Color(0xFFBDEEE8) : const Color(0xFF0A4F4A),
      surface: isDark ? const Color(0xFF0D1312) : const Color(0xFFF3F5F4),
      onSurface: isDark ? const Color(0xFFE6EEEC) : const Color(0xFF16211F),
      onSurfaceVariant: isDark ? const Color(0xFF9AACA9) : const Color(0xFF5C6B68),
      // Cards sit on the background as a lighter (light theme) or raised
      // (dark theme) surface: separation comes from that, not from shadows.
      surfaceContainerLow: isDark ? const Color(0xFF161F1E) : const Color(0xFFFFFFFF),
      surfaceContainerHighest: isDark ? const Color(0xFF202B29) : const Color(0xFFE8EDEB),
      outlineVariant: isDark ? const Color(0xFF263533) : const Color(0xFFE2E8E6),
      error: isDark ? const Color(0xFFEF8A90) : const Color(0xFFC0454D),
      errorContainer: isDark ? const Color(0xFF3D2225) : const Color(0xFFFBE7E8),
      onErrorContainer: isDark ? const Color(0xFFFFC9CC) : const Color(0xFF7A2429),
    );

    const text = TextTheme(
      headlineMedium: TextStyle(fontWeight: FontWeight.w700, letterSpacing: -0.4),
      headlineSmall: TextStyle(fontWeight: FontWeight.w700, letterSpacing: -0.2),
      titleLarge: TextStyle(fontWeight: FontWeight.w700, letterSpacing: -0.2),
      titleMedium: TextStyle(fontWeight: FontWeight.w600),
      titleSmall: TextStyle(fontWeight: FontWeight.w600),
      labelLarge: TextStyle(fontWeight: FontWeight.w600),
      labelMedium: TextStyle(fontWeight: FontWeight.w600),
    );

    const buttonShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(AppRadius.md)),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      textTheme: text,
      extensions: <ThemeExtension<dynamic>>[isDark ? AppPalette.dark : AppPalette.light],
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
      ),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, thickness: 1, space: 1),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith<Color?>(
          (states) => states.contains(WidgetState.selected) ? scheme.onPrimary : scheme.outline,
        ),
        trackColor: WidgetStateProperty.resolveWith<Color?>(
          (states) =>
              states.contains(WidgetState.selected) ? scheme.primary : scheme.surfaceContainerHighest,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith<Color?>(
          (states) =>
              states.contains(WidgetState.selected) ? Colors.transparent : scheme.outlineVariant,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(0, 48), shape: buttonShape),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 48),
          shape: buttonShape,
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
    );
  }
}
