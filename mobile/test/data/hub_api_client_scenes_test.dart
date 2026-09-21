import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/data/hub_api_exception.dart';
import 'package:tieu_home/models/scene.dart';

import '../support/fake_hub.dart';

TypeMatcher<HubApiException> hubError(HubApiErrorKind kind, {int? statusCode, String? code}) {
  return isA<HubApiException>()
      .having((e) => e.kind, 'kind', kind)
      .having((e) => e.statusCode, 'statusCode', statusCode)
      .having((e) => e.code, 'code', code);
}

Map<String, Object?> sceneJson({
  String id = 'scene-1',
  String name = 'Tắt toàn bộ quán',
  String icon = 'power-off',
}) =>
    {
      'id': id,
      'name': name,
      'icon': icon,
      'actions': [
        {'deviceId': 'tuya:light-1', 'functionCode': 'switch_1', 'value': false},
      ],
    };

void main() {
  group('fetchScenes', () {
    test('GETs /api/scenes and parses the list', () async {
      final hub = FakeHub()..respond('/api/scenes', {'scenes': [sceneJson(), sceneJson(id: 'scene-2')]});

      final scenes = await hub.apiClient().fetchScenes();

      expect(hub.calls, ['GET /api/scenes']);
      expect(scenes, hasLength(2));
      expect(scenes[0].id, 'scene-1');
      expect(scenes[0].actions.single.deviceId, 'tuya:light-1');
      expect(scenes[0].actions.single.value, isFalse);
    });

    test('an empty list is valid', () async {
      final hub = FakeHub()..respond('/api/scenes', {'scenes': <Object>[]});
      expect(await hub.apiClient().fetchScenes(), isEmpty);
    });
  });

  group('fetchScene', () {
    test('GETs /api/scenes/:id', () async {
      final hub = FakeHub()..respond('/api/scenes/scene-1', {'scene': sceneJson()});

      final scene = await hub.apiClient().fetchScene('scene-1');

      expect(hub.calls, ['GET /api/scenes/scene-1']);
      expect(scene.name, 'Tắt toàn bộ quán');
    });

    test('an unknown id is a server exception with SCENE_NOT_FOUND', () async {
      final hub = FakeHub()
        ..respond('/api/scenes/nope', {'error': 'not found', 'code': 'SCENE_NOT_FOUND'}, 404);

      await expectLater(
        hub.apiClient().fetchScene('nope'),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 404, code: 'SCENE_NOT_FOUND')),
      );
    });
  });

  group('createScene', () {
    test('POSTs {name, icon, actions} and parses the created scene', () async {
      final hub = FakeHub()..respondPost('/api/scenes', {'scene': sceneJson()}, 201);

      final scene = await hub.apiClient().createScene(
            name: 'Tắt toàn bộ quán',
            icon: 'power-off',
            actions: const [SceneAction(deviceId: 'tuya:light-1', functionCode: 'switch_1', value: false)],
          );

      expect(hub.posts.single.method, 'POST');
      expect(jsonDecode(hub.posts.single.body), {
        'name': 'Tắt toàn bộ quán',
        'icon': 'power-off',
        'actions': [
          {'deviceId': 'tuya:light-1', 'functionCode': 'switch_1', 'value': false},
        ],
      });
      expect(scene.id, 'scene-1');
    });

    test('a validation failure is a server exception with VALIDATION_ERROR', () async {
      final hub = FakeHub()
        ..respondPost('/api/scenes', {'error': 'bad', 'code': 'VALIDATION_ERROR'}, 400);

      await expectLater(
        hub.apiClient().createScene(name: '', icon: 'custom', actions: const []),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 400, code: 'VALIDATION_ERROR')),
      );
    });
  });

  group('updateScene', () {
    test('PUTs to /api/scenes/:id', () async {
      final hub = FakeHub()..respondPut('/api/scenes/scene-1', {'scene': sceneJson(name: 'Renamed')});

      final scene = await hub.apiClient().updateScene(
            'scene-1',
            name: 'Renamed',
            icon: 'power-off',
            actions: const [SceneAction(deviceId: 'tuya:light-1', functionCode: 'switch_1', value: false)],
          );

      expect(hub.calls, ['PUT /api/scenes/scene-1']);
      expect(scene.name, 'Renamed');
    });
  });

  group('deleteScene', () {
    test('DELETEs /api/scenes/:id and returns normally on 204', () async {
      final hub = FakeHub()..respondDelete('/api/scenes/scene-1');

      await hub.apiClient().deleteScene('scene-1');

      expect(hub.calls, ['DELETE /api/scenes/scene-1']);
    });

    test('an unknown id is a server exception with SCENE_NOT_FOUND', () async {
      final hub = FakeHub()
        ..respondDeleteError('/api/scenes/nope', {'error': 'not found', 'code': 'SCENE_NOT_FOUND'}, 404);

      await expectLater(
        hub.apiClient().deleteScene('nope'),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 404, code: 'SCENE_NOT_FOUND')),
      );
    });
  });

  group('executeScene', () {
    test('POSTs /api/scenes/:id/execute and parses per-action results', () async {
      final hub = FakeHub()
        ..respondPost('/api/scenes/scene-1/execute', {
          'sceneId': 'scene-1',
          'sceneName': 'Tắt toàn bộ quán',
          'success': false,
          'results': [
            {'deviceId': 'tuya:light-1', 'functionCode': 'switch_1', 'value': false, 'success': true},
            {
              'deviceId': 'tuya:gate-1',
              'functionCode': 'switch_led',
              'value': false,
              'success': false,
              'error': 'device is offline',
              'code': 'DEVICE_OFFLINE',
            },
          ],
        });

      final result = await hub.apiClient().executeScene('scene-1');

      expect(hub.calls, ['POST /api/scenes/scene-1/execute']);
      expect(result.success, isFalse);
      expect(result.results, hasLength(2));
      expect(result.failures, hasLength(1));
      expect(result.failures.single.deviceId, 'tuya:gate-1');
      expect(result.failures.single.error, 'device is offline');
    });

    test('a successful scene has no failures', () async {
      final hub = FakeHub()
        ..respondPost('/api/scenes/scene-1/execute', {
          'sceneId': 'scene-1',
          'success': true,
          'results': [
            {'deviceId': 'tuya:light-1', 'functionCode': 'switch_1', 'value': false, 'success': true},
          ],
        });

      final result = await hub.apiClient().executeScene('scene-1');

      expect(result.success, isTrue);
      expect(result.failures, isEmpty);
    });

    test('an unknown scene id is a server exception with SCENE_NOT_FOUND', () async {
      final hub = FakeHub()
        ..respondPost('/api/scenes/nope/execute', {'error': 'not found', 'code': 'SCENE_NOT_FOUND'}, 404);

      await expectLater(
        hub.apiClient().executeScene('nope'),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 404, code: 'SCENE_NOT_FOUND')),
      );
    });
  });
}
