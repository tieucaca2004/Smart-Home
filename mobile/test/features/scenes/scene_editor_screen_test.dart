import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/core/theme/app_theme.dart';
import 'package:tieu_home/features/scenes/scene_editor_screen.dart';
import 'package:tieu_home/models/scene.dart';

import '../../support/fake_hub.dart';

const String deviceId = 'tuya:light-1';

Map<String, Object?> devicesBody() => {
      'devices': [
        {'id': deviceId, 'nativeId': 'light-1', 'protocol': 'tuya', 'name': 'Đèn phòng khách', 'category': 'dj', 'online': true},
      ],
    };

Map<String, Object?> capabilitiesBody() => {
      'id': deviceId,
      'capabilities': {
        'id': deviceId,
        'protocol': 'tuya',
        'nativeId': 'light-1',
        'name': 'Đèn phòng khách',
        'online': true,
        'commands': [
          {'code': 'switch_1', 'type': 'Boolean', 'values': <String, Object?>{}},
          {'code': 'level', 'type': 'Integer', 'values': {'min': 0, 'max': 100}},
        ],
        'statuses': <Object>[],
      },
    };

Future<void> pumpEditor(WidgetTester tester, FakeHub hub, {Scene? scene}) async {
  await tester.pumpWidget(
    MaterialApp(theme: AppTheme.light(), home: SceneEditorScreen(client: hub.apiClient(), scene: scene)),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('creating a scene: name it, pick a device + Boolean command + ON, then save', (tester) async {
    final hub = FakeHub()
      ..respond('/api/devices', devicesBody())
      ..respond('/api/devices/$deviceId/capabilities', capabilitiesBody())
      ..respondPost('/api/scenes', {
        'scene': {
          'id': 'scene-1',
          'name': 'Mở quán',
          'icon': 'sun',
          'actions': [
            {'deviceId': deviceId, 'functionCode': 'switch_1', 'value': true},
          ],
        },
      }, 201);

    await pumpEditor(tester, hub);

    expect(find.text('Cảnh mới'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'Mở quán');
    await tester.tap(find.byKey(const ValueKey('icon-sun')));
    await tester.pumpAndSettle();

    // Add an action: device -> Boolean command -> ON.
    await tester.tap(find.text('Thêm hành động'));
    await tester.pumpAndSettle();
    expect(find.text('Chọn thiết bị'), findsOneWidget);

    await tester.tap(find.text('Đèn phòng khách'));
    await tester.pumpAndSettle();
    // Integer commands (e.g. "level") are never offered — MVP is Boolean-only.
    expect(find.byKey(const ValueKey('pick-command-switch_1')), findsOneWidget);
    expect(find.byKey(const ValueKey('pick-command-level')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('pick-command-switch_1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('pick-value-on')));
    await tester.pumpAndSettle();

    // Back on the editor, with the picked action listed.
    expect(find.text('Cảnh mới'), findsOneWidget);
    expect(find.text('Đèn phòng khách'), findsOneWidget);
    expect(find.text('Công tắc 1 → Bật'), findsOneWidget);

    await tester.tap(find.byTooltip('Lưu'));
    await tester.pumpAndSettle();

    expect(jsonDecode(hub.posts.single.body), {
      'name': 'Mở quán',
      'icon': 'sun',
      'actions': [
        {'deviceId': deviceId, 'functionCode': 'switch_1', 'value': true},
      ],
    });
  });

  testWidgets('saving with no name shows a validation message and does not call the Hub', (tester) async {
    final hub = FakeHub();

    await pumpEditor(tester, hub);
    await tester.tap(find.byTooltip('Lưu'));
    await tester.pumpAndSettle();

    expect(find.text('Hãy đặt tên cho cảnh.'), findsOneWidget);
    expect(hub.calls, isEmpty);
  });

  testWidgets('saving with a name but no actions shows a validation message', (tester) async {
    final hub = FakeHub();

    await pumpEditor(tester, hub);
    await tester.enterText(find.byType(TextField).first, 'Cảnh trống');
    await tester.tap(find.byTooltip('Lưu'));
    await tester.pumpAndSettle();

    expect(find.text('Hãy thêm ít nhất một hành động.'), findsOneWidget);
    expect(hub.calls, isEmpty);
  });

  testWidgets('editing an existing scene pre-fills its name, icon and actions', (tester) async {
    final hub = FakeHub();
    const scene = Scene(
      id: 'scene-9',
      name: 'Tắt toàn bộ quán',
      icon: 'power-off',
      actions: [SceneAction(deviceId: deviceId, functionCode: 'switch_1', value: false)],
    );

    await pumpEditor(tester, hub, scene: scene);

    expect(find.text('Sửa cảnh'), findsOneWidget);
    expect(find.text('Tắt toàn bộ quán'), findsOneWidget);
    expect(find.text(deviceId), findsOneWidget); // no friendly name available without re-fetching
    expect(find.textContaining('Tắt'), findsWidgets);
  });
}
