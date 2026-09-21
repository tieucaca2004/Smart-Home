import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/data/hub_api_exception.dart';
import 'package:tieu_home/models/automation.dart';

import '../support/fake_hub.dart';

TypeMatcher<HubApiException> hubError(HubApiErrorKind kind, {int? statusCode, String? code}) {
  return isA<HubApiException>()
      .having((e) => e.kind, 'kind', kind)
      .having((e) => e.statusCode, 'statusCode', statusCode)
      .having((e) => e.code, 'code', code);
}

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

void main() {
  group('fetchAutomations', () {
    test('GETs /api/automations and parses the list', () async {
      final hub = FakeHub()
        ..respond('/api/automations', {'automations': [automationJson(), automationJson(id: 'auto-2')]});

      final automations = await hub.apiClient().fetchAutomations();

      expect(hub.calls, ['GET /api/automations']);
      expect(automations, hasLength(2));
      expect(automations[0].trigger.type, 'daily');
      expect(automations[0].trigger.time, '18:00');
      expect(automations[0].enabled, isTrue);
    });
  });

  group('fetchAutomation', () {
    test('GETs /api/automations/:id', () async {
      final hub = FakeHub()..respond('/api/automations/auto-1', {'automation': automationJson()});

      final automation = await hub.apiClient().fetchAutomation('auto-1');

      expect(hub.calls, ['GET /api/automations/auto-1']);
      expect(automation.sceneId, 'scene-1');
    });

    test('an unknown id is a server exception with AUTOMATION_NOT_FOUND', () async {
      final hub = FakeHub()
        ..respond('/api/automations/nope', {'error': 'not found', 'code': 'AUTOMATION_NOT_FOUND'}, 404);

      await expectLater(
        hub.apiClient().fetchAutomation('nope'),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 404, code: 'AUTOMATION_NOT_FOUND')),
      );
    });
  });

  group('createAutomation', () {
    test('POSTs {name, enabled, trigger, sceneId}', () async {
      final hub = FakeHub()..respondPost('/api/automations', {'automation': automationJson()}, 201);

      final automation = await hub.apiClient().createAutomation(
            name: 'Mở quán lúc 18:00',
            enabled: true,
            trigger: const AutomationTrigger(type: 'daily', time: '18:00'),
            sceneId: 'scene-1',
          );

      expect(jsonDecode(hub.posts.single.body), {
        'name': 'Mở quán lúc 18:00',
        'enabled': true,
        'trigger': {'type': 'daily', 'time': '18:00'},
        'sceneId': 'scene-1',
      });
      expect(automation.id, 'auto-1');
    });

    test('an unknown sceneId is a server exception with SCENE_NOT_FOUND', () async {
      final hub = FakeHub()
        ..respondPost('/api/automations', {'error': 'no such scene', 'code': 'SCENE_NOT_FOUND'}, 404);

      await expectLater(
        hub.apiClient().createAutomation(
              name: 'X',
              enabled: true,
              trigger: const AutomationTrigger(type: 'daily', time: '18:00'),
              sceneId: 'nope',
            ),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 404, code: 'SCENE_NOT_FOUND')),
      );
    });
  });

  group('updateAutomation', () {
    test('PUTs to /api/automations/:id, e.g. to disable it', () async {
      final hub = FakeHub()
        ..respondPut('/api/automations/auto-1', {'automation': automationJson(enabled: false)});

      final automation = await hub.apiClient().updateAutomation(
            'auto-1',
            name: 'Mở quán lúc 18:00',
            enabled: false,
            trigger: const AutomationTrigger(type: 'daily', time: '18:00'),
            sceneId: 'scene-1',
          );

      expect(hub.calls, ['PUT /api/automations/auto-1']);
      expect(automation.enabled, isFalse);
    });
  });

  group('deleteAutomation', () {
    test('DELETEs /api/automations/:id and returns normally on 204', () async {
      final hub = FakeHub()..respondDelete('/api/automations/auto-1');

      await hub.apiClient().deleteAutomation('auto-1');

      expect(hub.calls, ['DELETE /api/automations/auto-1']);
    });

    test('an unknown id is a server exception with AUTOMATION_NOT_FOUND', () async {
      final hub = FakeHub()
        ..respondDeleteError(
          '/api/automations/nope',
          {'error': 'not found', 'code': 'AUTOMATION_NOT_FOUND'},
          404,
        );

      await expectLater(
        hub.apiClient().deleteAutomation('nope'),
        throwsA(hubError(HubApiErrorKind.server, statusCode: 404, code: 'AUTOMATION_NOT_FOUND')),
      );
    });
  });
}
