import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/core/theme/app_palette.dart';
import 'package:tieu_home/core/theme/app_theme.dart';
import 'package:tieu_home/core/theme/app_tokens.dart';

// Sprint 4: the design system. The numbers here are the promises the screens
// rely on: readable text, a real type hierarchy, one spacing and radius scale.

/// WCAG contrast ratio of two colors.
double contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final lighter = la > lb ? la : lb;
  final darker = la > lb ? lb : la;
  return (lighter + 0.05) / (darker + 0.05);
}

void main() {
  for (final brightness in Brightness.values) {
    group('AppTheme (${brightness.name})', () {
      final theme = brightness == Brightness.light ? AppTheme.light() : AppTheme.dark();
      final scheme = theme.colorScheme;
      final palette = theme.extension<AppPalette>()!;

      test('is Material 3, has the right brightness and carries the palette', () {
        expect(theme.useMaterial3, isTrue);
        expect(theme.brightness, brightness);
        expect(theme.colorScheme.brightness, brightness);
      });

      test('text is readable (WCAG AA, 4.5:1) on the background and on cards', () {
        final pairs = <String, (Color, Color)>{
          'text on background': (scheme.onSurface, scheme.surface),
          'text on card': (scheme.onSurface, scheme.surfaceContainerLow),
          'secondary text on background': (scheme.onSurfaceVariant, scheme.surface),
          'secondary text on card': (scheme.onSurfaceVariant, scheme.surfaceContainerLow),
          'secondary text on a muted fill': (scheme.onSurfaceVariant, scheme.surfaceContainerHighest),
          'primary on card': (scheme.primary, scheme.surfaceContainerLow),
          'icon on primary': (scheme.onPrimary, scheme.primary),
          'text on primary container': (scheme.onPrimaryContainer, scheme.primaryContainer),
          'error on card': (scheme.error, scheme.surfaceContainerLow),
          'text on error container': (scheme.onErrorContainer, scheme.errorContainer),
        };
        pairs.forEach((name, colors) {
          expect(contrast(colors.$1, colors.$2), greaterThanOrEqualTo(4.5), reason: name);
        });
      });

      test('status colors are readable on their containers and on cards', () {
        final pairs = <String, (Color, Color)>{
          'online on its container': (palette.onSuccessContainer, palette.successContainer),
          'online on a card': (palette.onSuccessContainer, scheme.surfaceContainerLow),
          'offline on its container': (palette.onOfflineContainer, palette.offlineContainer),
          'offline on a card': (palette.onOfflineContainer, scheme.surfaceContainerLow),
          'warning on its container': (palette.onWarningContainer, palette.warningContainer),
        };
        pairs.forEach((name, colors) {
          expect(contrast(colors.$1, colors.$2), greaterThanOrEqualTo(4.5), reason: name);
        });
      });

      test('cards are visibly separated from the background', () {
        expect(scheme.surfaceContainerLow, isNot(scheme.surface));
        expect(theme.scaffoldBackgroundColor, scheme.surface);
      });

      testWidgets('the type scale is a real hierarchy', (tester) async {
        // A raw ThemeData has no font sizes: Flutter adds them (the "geometry"
        // of the script in use) in Theme.of. So the hierarchy is read the way
        // every widget reads it, from Theme.of inside an app using this theme.
        late TextTheme effective;
        await tester.pumpWidget(
          MaterialApp(
            theme: theme,
            home: Builder(
              builder: (context) {
                effective = Theme.of(context).textTheme;
                return const SizedBox();
              },
            ),
          ),
        );

        final sizes = [
          effective.headlineMedium!.fontSize!,
          effective.headlineSmall!.fontSize!,
          effective.titleLarge!.fontSize!,
          effective.titleMedium!.fontSize!,
          effective.bodyMedium!.fontSize!,
          effective.bodySmall!.fontSize!,
        ];
        for (var i = 1; i < sizes.length; i++) {
          expect(sizes[i], lessThan(sizes[i - 1]), reason: 'level $i is smaller than level ${i - 1}');
        }

        // The app's own weights survive the merge with Flutter's geometry:
        // headings are bold, titles semi-bold.
        expect(effective.headlineMedium!.fontWeight, FontWeight.w700);
        expect(effective.titleLarge!.fontWeight, FontWeight.w700);
        expect(effective.titleMedium!.fontWeight, FontWeight.w600);
      });
    });
  }

  group('AppPalette', () {
    testWidgets('a bare MaterialApp (no AppTheme) still gets the matching palette', (tester) async {
      late AppPalette seen;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              seen = AppPalette.of(context);
              return const SizedBox();
            },
          ),
        ),
      );
      expect(seen, same(AppPalette.light));

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(brightness: Brightness.dark),
          home: Builder(
            builder: (context) {
              seen = AppPalette.of(context);
              return const SizedBox();
            },
          ),
        ),
      );
      // Swapping the theme of a running MaterialApp animates (AnimatedTheme,
      // 200 ms) from the old theme to the new one, and halfway through it is
      // still the light one. Wait for the transition to finish first.
      await tester.pumpAndSettle();
      expect(seen, same(AppPalette.dark));
      expect(seen.success, AppPalette.dark.success);
      expect(seen.offline, AppPalette.dark.offline);
      expect(seen.success, isNot(AppPalette.light.success));
    });

    testWidgets('AppTheme hands out the palette that matches its brightness', (tester) async {
      for (final brightness in Brightness.values) {
        final theme = brightness == Brightness.light ? AppTheme.light() : AppTheme.dark();
        late AppPalette seen;
        await tester.pumpWidget(
          MaterialApp(
            theme: theme,
            home: Builder(
              builder: (context) {
                seen = AppPalette.of(context);
                return const SizedBox();
              },
            ),
          ),
        );
        await tester.pumpAndSettle();

        final expected = brightness == Brightness.light ? AppPalette.light : AppPalette.dark;
        expect(seen.success, expected.success, reason: brightness.name);
        expect(seen.successContainer, expected.successContainer, reason: brightness.name);
        expect(seen.offline, expected.offline, reason: brightness.name);
        expect(seen.offlineContainer, expected.offlineContainer, reason: brightness.name);
        expect(seen.warning, expected.warning, reason: brightness.name);
      }
    });

    test('lerp and copyWith behave', () {
      expect(AppPalette.light.lerp(AppPalette.dark, 0).success, AppPalette.light.success);
      expect(AppPalette.light.lerp(AppPalette.dark, 1).success, AppPalette.dark.success);
      expect(AppPalette.light.lerp(null, 0.5), AppPalette.light);
      expect(AppPalette.light.copyWith(success: Colors.red).success, Colors.red);
      expect(AppPalette.light.copyWith().offline, AppPalette.light.offline);
    });
  });

  group('tokens', () {
    test('spacing and radius are increasing scales', () {
      const spacing = [
        AppSpacing.xs,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.xl,
        AppSpacing.xxl,
      ];
      for (var i = 1; i < spacing.length; i++) {
        expect(spacing[i], greaterThan(spacing[i - 1]));
      }
      const radius = [AppRadius.sm, AppRadius.md, AppRadius.lg, AppRadius.xl];
      for (var i = 1; i < radius.length; i++) {
        expect(radius[i], greaterThan(radius[i - 1]));
      }
    });
  });
}