import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/core/theme/app_theme.dart';
import 'package:tieu_home/features/scenes/automation_editor_screen.dart';
import 'package:tieu_home/models/automation.dart';

import '../../support/fake_hub.dart';

Map<String, Object?> scenesBody() => {
      'scenes': [
        {
          'id': 'scene-1',
          'name': 'Mở quán',
          'icon': 'sun',
          'actions': [
            {'deviceId': 'tuya:a', 'functionCode': 'switch_1', 'value': true},
          ],
        },
        {
          'id': 'scene-2',
          'name': 'Tắt toàn bộ quán',
          'icon': 'power-off',
          'actions': [
            {'deviceId': 'tuya:a', 'functionCode': 'switch_1', 'value': false},
          ],
        },
      ],
    };

Future<void> pumpEditor(WidgetTester tester, FakeHub hub, {Automation? automation}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light(),
      home: AutomationEditorScreen(client: hub.apiClient(), automation: automation),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('creating an automation: name it, keep the default time, pick a scene, save', (tester) async {
    final hub = FakeHub()
      ..respond('/api/scenes', scenesBody())
      ..respondPost('/api/automations', {
        'automation': {
          'id': 'auto-1',
          'name': 'Mở quán lúc 18:00',
          'enabled': true,
          'trigger': {'type': 'daily', 'time': '18:00'},
          'sceneId': 'scene-1',
        },
      }, 201);

    await pumpEditor(tester, hub);

    expect(find.text('Tự động hoá mới'), findsOneWidget);
    expect(find.text('Mỗi ngày, 18:00'), findsOneWidget); // the built-in default

    await tester.enterText(find.byType(TextField).first, 'Mở quán lúc 18:00');
    await tester.tap(find.byKey(const ValueKey('pick-scene-scene-1')));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Lưu'));
    await tester.pumpAndSettle();

    expect(jsonDecode(hub.posts.single.body), {
      'name': 'Mở quán lúc 18:00',
      'enabled': true,
      'trigger': {'type': 'daily', 'time': '18:00'},
      'sceneId': 'scene-1',
    });
  });

  testWidgets('the time picker opens and confirming keeps the shown time', (tester) async {
    final hub = FakeHub()..respond('/api/scenes', {'scenes': <Object>[]});

    await pumpEditor(tester, hub);

    await tester.tap(find.text('Chạy lúc'));
    await tester.pumpAndSettle();
    expect(find.byType(TimePickerDialog), findsOneWidget);

    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();

    expect(find.text('Mỗi ngày, 18:00'), findsOneWidget);
  });

  testWidgets('saving with no name shows a validation message and does not call the Hub', (tester) async {
    final hub = FakeHub()..respond('/api/scenes', scenesBody());

    await pumpEditor(tester, hub);
    await tester.tap(find.byKey(const ValueKey('pick-scene-scene-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Lưu'));
    await tester.pumpAndSettle();

    expect(find.text('Hãy đặt tên cho tự động hoá.'), findsOneWidget);
    expect(hub.posts, isEmpty);
  });

  testWidgets('saving with a name but no scene picked shows a validation message', (tester) async {
    final hub = FakeHub()..respond('/api/scenes', scenesBody());

    await pumpEditor(tester, hub);
    await tester.enterText(find.byType(TextField).first, 'X');
    await tester.tap(find.byTooltip('Lưu'));
    await tester.pumpAndSettle();

    expect(find.text('Hãy chọn một cảnh để chạy.'), findsOneWidget);
    expect(hub.posts, isEmpty);
  });

  testWidgets('editing an existing automation pre-fills name, time, scene and enabled', (tester) async {
    final hub = FakeHub()..respond('/api/scenes', scenesBody());
    const automation = Automation(
      id: 'auto-1',
      name: 'Mở quán lúc 18:00',
      enabled: false,
      trigger: AutomationTrigger(type: 'daily', time: '07:30'),
      sceneId: 'scene-2',
    );

    await pumpEditor(tester, hub, automation: automation);

    expect(find.text('Sửa tự động hoá'), findsOneWidget);
    expect(find.text('Mở quán lúc 18:00'), findsOneWidget);
    expect(find.text('Mỗi ngày, 07:30'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
  });
}
