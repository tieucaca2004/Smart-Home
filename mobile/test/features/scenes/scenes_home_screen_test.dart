import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/core/theme/app_theme.dart';
import 'package:tieu_home/features/scenes/scenes_home_screen.dart';

import '../../support/fake_hub.dart';

Map<String, Object?> sceneJson({
  String id = 'scene-1',
  String name = 'Tắt toàn bộ quán',
  String icon = 'power-off',
  List<Map<String, Object?>>? actions,
}) =>
    {
      'id': id,
      'name': name,
      'icon': icon,
      'actions': actions ??
          [
            {'deviceId': 'tuya:light-1', 'functionCode': 'switch_1', 'value': false},
          ],
    };

Map<String, Object?> automationJson({
  String id = 'auto-1',
  String name = 'Mở quán lúc 18:00',
  bool enabled = true,
  String time = '18:00',
  String sceneId = 'scene-1',
}) =>
    {
      'id': id,
      'name': name,
      'enabled': enabled,
      'trigger': {'type': 'daily', 'time': time},
      'sceneId': sceneId,
    };

Future<void> pumpScreen(WidgetTester tester, FakeHub hub) async {
  await tester.pumpWidget(
    MaterialApp(theme: AppTheme.light(), home: ScenesHomeScreen(client: hub.apiClient())),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('loading and empty state', () {
    testWidgets('an empty Hub shows hints to create a scene and an automation', (tester) async {
      final hub = FakeHub()
        ..respond('/api/scenes', {'scenes': <Object>[]})
        ..respond('/api/automations', {'automations': <Object>[]});

      await pumpScreen(tester, hub);

      expect(find.text('Ngữ cảnh'), findsOneWidget);
      expect(find.text('Chưa có cảnh nào. Nhấn + để tạo cảnh đầu tiên.'), findsOneWidget);
      expect(find.text('Cần có ít nhất một cảnh trước khi tạo tự động hoá.'), findsOneWidget);
    });

    testWidgets('a network failure shows an inline error with retry', (tester) async {
      final hub = FakeHub()..failNetwork('/api/scenes');

      await pumpScreen(tester, hub);

      expect(find.text('Không kết nối được với Hub'), findsOneWidget);
      expect(find.text('Thử lại'), findsOneWidget);
    });
  });

  group('scene list', () {
    testWidgets('shows each scene with its action count, and each automation with its time and scene', (tester) async {
      final hub = FakeHub()
        ..respond('/api/scenes', {
          'scenes': [
            sceneJson(),
            sceneJson(id: 'scene-2', name: 'Mở quán', actions: [
              {'deviceId': 'tuya:a', 'functionCode': 'switch_1', 'value': true},
              {'deviceId': 'tuya:b', 'functionCode': 'switch_1', 'value': true},
            ]),
          ],
        })
        ..respond('/api/automations', {
          'automations': [automationJson(sceneId: 'scene-2')],
        });

      await pumpScreen(tester, hub);

      expect(find.text('Tắt toàn bộ quán'), findsOneWidget);
      expect(find.text('1 hành động'), findsOneWidget);
      expect(find.text('Mở quán'), findsWidgets); // scene name + scene name inside automation subtitle
      expect(find.text('2 hành động'), findsOneWidget);
      expect(find.text('Mở quán lúc 18:00'), findsOneWidget);
      expect(find.text('Mỗi ngày 18:00 · Mở quán'), findsOneWidget);
    });

    testWidgets('running a scene that fully succeeds shows a success snackbar', (tester) async {
      final hub = FakeHub()
        ..respond('/api/scenes', {'scenes': [sceneJson()]})
        ..respond('/api/automations', {'automations': <Object>[]})
        ..respondPost('/api/scenes/scene-1/execute', {
          'sceneId': 'scene-1',
          'success': true,
          'results': [
            {'deviceId': 'tuya:light-1', 'functionCode': 'switch_1', 'value': false, 'success': true},
          ],
        });

      await pumpScreen(tester, hub);
      await tester.tap(find.byKey(const ValueKey('run-scene-scene-1')));
      await tester.pumpAndSettle();

      expect(find.text('Đã chạy "Tắt toàn bộ quán".'), findsOneWidget);
    });

    testWidgets('running a scene that partially fails shows how many actions failed', (tester) async {
      final hub = FakeHub()
        ..respond('/api/scenes', {'scenes': [sceneJson()]})
        ..respond('/api/automations', {'automations': <Object>[]})
        ..respondPost('/api/scenes/scene-1/execute', {
          'sceneId': 'scene-1',
          'success': false,
          'results': [
            {
              'deviceId': 'tuya:light-1',
              'functionCode': 'switch_1',
              'value': false,
              'success': false,
              'error': 'device is offline',
              'code': 'DEVICE_OFFLINE',
            },
          ],
        });

      await pumpScreen(tester, hub);
      await tester.tap(find.byKey(const ValueKey('run-scene-scene-1')));
      await tester.pumpAndSettle();

      expect(
        find.text('"Tắt toàn bộ quán" thất bại một phần: 1/1 hành động không thành công.'),
        findsOneWidget,
      );
    });

    testWidgets('deleting a scene asks for confirmation, then removes it', (tester) async {
      final hub = FakeHub()
        ..respond('/api/scenes', {'scenes': [sceneJson()]})
        ..respond('/api/automations', {'automations': <Object>[]})
        ..respondDelete('/api/scenes/scene-1');

      await pumpScreen(tester, hub);
      expect(find.text('Tắt toàn bộ quán'), findsOneWidget);

      await tester.tap(find.widgetWithIcon(IconButton, Icons.delete_outline_rounded).first);
      await tester.pumpAndSettle();
      expect(find.text('Xoá cảnh "Tắt toàn bộ quán"?'), findsOneWidget);

      hub.respond('/api/scenes', {'scenes': <Object>[]});
      await tester.tap(find.text('Xoá'));
      await tester.pumpAndSettle();

      expect(find.text('Tắt toàn bộ quán'), findsNothing);
      expect(hub.calls, contains('DELETE /api/scenes/scene-1'));
    });
  });

  group('automation enable/disable', () {
    testWidgets('toggling the switch calls the Hub and reflects the new state', (tester) async {
      final hub = FakeHub()
        ..respond('/api/scenes', {'scenes': [sceneJson()]})
        ..respond('/api/automations', {'automations': [automationJson()]})
        ..respondPut('/api/automations/auto-1', {'automation': automationJson(enabled: false)});

      await pumpScreen(tester, hub);

      final toggle = find.byKey(const ValueKey('toggle-automation-auto-1'));
      expect(tester.widget<Switch>(toggle).value, isTrue);

      hub.respond('/api/automations', {
        'automations': [automationJson(enabled: false)],
      });
      await tester.tap(toggle);
      await tester.pumpAndSettle();

      expect(tester.widget<Switch>(find.byKey(const ValueKey('toggle-automation-auto-1'))).value, isFalse);
    });
  });
}
