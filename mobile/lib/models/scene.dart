import 'json_helpers.dart';

/// One step of a [Scene]: set a device's Boolean command to a fixed value.
///
/// MVP supports Boolean commands only (see `ControlKind.toggle` on the
/// device screens) — [value] is always a plain `true`/`false`, never a
/// number or an enum. [deviceId] and [functionCode] are always whatever the
/// Hub itself reports for a real device's real capabilities; nothing here is
/// a fixed code or a fixed device.
class SceneAction {
  const SceneAction({required this.deviceId, required this.functionCode, required this.value});

  factory SceneAction.fromJson(Map<String, dynamic> json) => SceneAction(
        deviceId: requiredString(json, 'deviceId'),
        functionCode: requiredString(json, 'functionCode'),
        value: json['value'] == true,
      );

  final String deviceId;
  final String functionCode;
  final bool value;

  Map<String, Object?> toJson() => {'deviceId': deviceId, 'functionCode': functionCode, 'value': value};
}

/// A saved, named, ordered list of [SceneAction]s that run together under one
/// button ("Tắt toàn bộ quán"). [icon] is one of [sceneIconKeys] — purely
/// presentational, chosen by the person, never derived from a device.
class Scene {
  const Scene({required this.id, required this.name, required this.icon, required this.actions});

  factory Scene.fromJson(Map<String, dynamic> json) {
    final actionsJson = json['actions'];
    return Scene(
      id: requiredString(json, 'id'),
      name: requiredString(json, 'name'),
      icon: optionalString(json['icon']) ?? 'custom',
      actions: actionsJson is List
          ? <SceneAction>[for (final a in actionsJson) SceneAction.fromJson(asJsonObject(a, 'scene action'))]
          : const <SceneAction>[],
    );
  }

  final String id;
  final String name;
  final String icon;
  final List<SceneAction> actions;
}

/// Icon keys the Hub's SceneService accepts (kept in sync with
/// `SCENE_ICONS` in `src/services/sceneService.js`). A dropdown/chooser
/// picks from this list; nothing free-form is sent to the Hub.
const List<String> sceneIconKeys = ['power-on', 'power-off', 'sun', 'moon', 'home', 'custom'];

/// What happened when one [SceneAction] of a scene ran.
class SceneActionResult {
  const SceneActionResult({
    required this.deviceId,
    required this.functionCode,
    required this.value,
    required this.success,
    this.error,
  });

  factory SceneActionResult.fromJson(Map<String, dynamic> json) => SceneActionResult(
        deviceId: requiredString(json, 'deviceId'),
        functionCode: requiredString(json, 'functionCode'),
        value: json['value'] == true,
        success: json['success'] == true,
        error: optionalString(json['error']),
      );

  final String deviceId;
  final String functionCode;
  final bool value;
  final bool success;

  /// Why the action failed (rejected command, offline device, unconfirmed
  /// value, ...); null when [success] is true.
  final String? error;
}

/// The result of `POST /api/scenes/:id/execute`: whether every action
/// succeeded, and the per-action detail so a failure can point at exactly
/// which device did not confirm.
class SceneExecutionResult {
  const SceneExecutionResult({required this.sceneId, required this.success, required this.results});

  factory SceneExecutionResult.fromJson(Map<String, dynamic> json) {
    final resultsJson = json['results'];
    return SceneExecutionResult(
      sceneId: requiredString(json, 'sceneId'),
      success: json['success'] == true,
      results: resultsJson is List
          ? <SceneActionResult>[
              for (final r in resultsJson) SceneActionResult.fromJson(asJsonObject(r, 'scene action result')),
            ]
          : const <SceneActionResult>[],
    );
  }

  final String sceneId;
  final bool success;
  final List<SceneActionResult> results;

  /// The actions that did not succeed, for a "what went wrong" list.
  List<SceneActionResult> get failures => [for (final r in results) if (!r.success) r];
}
