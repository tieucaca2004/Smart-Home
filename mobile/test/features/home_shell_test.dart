import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/app.dart';
import 'package:tieu_home/features/scenes/scenes_home_screen.dart';

import '../support/fake_hub.dart';

void main() {
  testWidgets('starts on "Thiết bị" and switches to "Ngữ cảnh" without duplicating the Scaffold', (tester) async {
    final hub = FakeHub()
      ..respond('/api/devices', {'devices': <Object>[]})
      ..respond('/api/scenes', {'scenes': <Object>[]})
      ..respond('/api/automations', {'automations': <Object>[]});

    await tester.pumpWidget(TieuHomeApp(client: hub.apiClient()));
    await tester.pumpAndSettle();

    expect(find.text('Thiết bị'), findsOneWidget); // the device-list section heading
    expect(find.byType(ScenesHomeScreen), findsNothing); // the inactive tab never mounted
    expect(find.byType(Scaffold), findsOneWidget);
    // Only /api/devices so far — the inactive tab never mounted.
    expect(hub.calls, ['GET /api/devices']);

    await tester.tap(find.text('Ngữ cảnh')); // the bottom nav destination label
    await tester.pumpAndSettle();

    expect(find.byType(ScenesHomeScreen), findsOneWidget);
    expect(find.byType(Scaffold), findsOneWidget);
    expect(hub.calls, ['GET /api/devices', 'GET /api/scenes', 'GET /api/automations']);

    await tester.tap(find.text('Trang chủ'));
    await tester.pumpAndSettle();

    expect(find.text('Thiết bị'), findsOneWidget);
    expect(find.byType(ScenesHomeScreen), findsNothing);
    expect(find.byType(Scaffold), findsOneWidget);
  });
}
