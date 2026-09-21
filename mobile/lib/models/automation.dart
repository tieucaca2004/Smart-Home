import 'json_helpers.dart';

/// When an [Automation] fires. MVP has exactly one kind: a wall-clock time of
/// day the Hub reaches once every day (its own local time). More kinds
/// (sunset, a device changing state, ...) are additive later — nothing on
/// the Flutter side assumes `daily` is the only [type] that will ever exist,
/// but it is the only one the editor UI offers today.
class AutomationTrigger {
  const AutomationTrigger({required this.type, required this.time});

  factory AutomationTrigger.fromJson(Map<String, dynamic> json) => AutomationTrigger(
        type: requiredString(json, 'type'),
        time: requiredString(json, 'time'),
      );

  /// Always `"daily"` today.
  final String type;

  /// `"HH:MM"`, 24h, in the Hub's own local time.
  final String time;

  Map<String, Object?> toJson() => {'type': type, 'time': time};
}

/// A saved rule: "at this time, run this scene". Evaluated by the Hub's own
/// scheduler — the app only creates/edits/lists the rule, it never runs the
/// timer itself.
class Automation {
  const Automation({
    required this.id,
    required this.name,
    required this.enabled,
    required this.trigger,
    required this.sceneId,
  });

  factory Automation.fromJson(Map<String, dynamic> json) => Automation(
        id: requiredString(json, 'id'),
        name: requiredString(json, 'name'),
        enabled: json['enabled'] == true,
        trigger: AutomationTrigger.fromJson(asJsonObject(json['trigger'], '"trigger"')),
        sceneId: requiredString(json, 'sceneId'),
      );

  final String id;
  final String name;
  final bool enabled;
  final AutomationTrigger trigger;
  final String sceneId;
}
