import 'package:flutter/material.dart';

import '../../models/device.dart';

/// What a device looks like to the person using the app: the icon and the
/// short Vietnamese type name shown on its card.
///
/// This is a presentation mapping and nothing more. It never changes the
/// category the Hub reports, never feeds back into the device model, and no
/// behavior (commands, status, controls) depends on it. A device it cannot
/// recognise is [generic], which is a perfectly good answer.
enum DeviceKind {
  light('Đèn', Icons.lightbulb_outline_rounded),
  switchGear('Công tắc', Icons.toggle_on_rounded),
  socket('Ổ cắm', Icons.power_rounded),
  fan('Quạt', Icons.air_rounded),
  door('Cửa', Icons.door_front_door_rounded),
  fridge('Tủ lạnh', Icons.kitchen_rounded),
  remote('Hồng ngoại', Icons.settings_remote_rounded),
  sensor('Cảm biến', Icons.sensors_rounded),
  curtain('Rèm', Icons.curtains_rounded),
  climate('Điều hòa', Icons.ac_unit_rounded),
  generic('Thiết bị khác', Icons.devices_other_rounded);

  const DeviceKind(this.label, this.icon);

  /// Vietnamese type name, for the card's secondary line.
  final String label;

  final IconData icon;
}

/// The kind of [device], inferred from what the Hub tells us about it.
///
/// 1. The category, when it is one this file knows. Vendor category codes
///    are terse (a switch is a two-letter code), so they are matched whole;
///    descriptive words (`light`, `door`, `infrared` ...) are matched anywhere
///    in the category.
/// 2. Otherwise the device's name. Vietnamese names put the noun first
///    ("Đèn phòng khách", "Cảm biến cửa"), so when several words match, the
///    one that appears first decides.
/// 3. Otherwise [DeviceKind.generic].
///
/// The list screen has only these two facts per device (fetching every
/// device's capabilities just to pick an icon would add requests), so the
/// detail screen uses the same inputs and shows the same icon.
DeviceKind deviceKindOf(Device device) {
  final category = device.category?.trim().toLowerCase();
  if (category != null && category.isNotEmpty) {
    for (final rule in _categoryRules) {
      if (rule.pattern.hasMatch(category)) return rule.kind;
    }
  }

  final name = device.name?.trim().toLowerCase();
  if (name != null && name.isNotEmpty) {
    final kind = _kindFromName(name);
    if (kind != null) return kind;
  }

  return DeviceKind.generic;
}

class _KindRule {
  _KindRule(this.kind, String pattern) : pattern = RegExp(pattern);

  final DeviceKind kind;
  final RegExp pattern;
}

/// Order matters: a more specific kind comes before the general one it
/// contains (an infrared *light* is a remote, a fan *light* is a fan).
final List<_KindRule> _categoryRules = <_KindRule>[
  _KindRule(DeviceKind.remote, r'^(?:wnykq|hwktwkq)$|infrared|remote'),
  _KindRule(DeviceKind.fridge, r'^bx$|fridge|freezer|refrigerator'),
  _KindRule(DeviceKind.door, r'^(?:mcs|ms|ckmkzq)$|door|gate|lock'),
  _KindRule(DeviceKind.fan, r'^(?:fs|fsd)$|fan'),
  _KindRule(DeviceKind.light, r'^(?:dj|dd|xdd|fwd|tgq)$|light|lamp|bulb'),
  _KindRule(DeviceKind.socket, r'^(?:cz|pc)$|socket|plug|outlet'),
  _KindRule(DeviceKind.switchGear, r'^(?:kg|tgkg)$|switch'),
  _KindRule(DeviceKind.curtain, r'^(?:cl|clkg)$|curtain|blind'),
  _KindRule(DeviceKind.climate, r'^(?:kt|ktkzq|wk)$|air_?con|thermostat'),
  _KindRule(DeviceKind.sensor, r'^(?:wsdcg|pir|ywbj|rqbj)$|sensor'),
];

/// Matched against the lower-cased name, in Vietnamese (with and without
/// accents) and English. `\b` is only used around plain ASCII words.
final List<_KindRule> _nameRules = <_KindRule>[
  _KindRule(DeviceKind.remote, r'hồng ngoại|hong ngoai|\bir\b|infrared|remote|điều khiển từ xa'),
  _KindRule(DeviceKind.fridge, r'tủ lạnh|tu lanh|tủ đông|tu dong|tủ mát|tu mat|fridge|freezer|refrigerator'),
  _KindRule(DeviceKind.door, r'cửa|\bcua\b|khóa|khoá|\bdoor\b|\bgate\b|\block\b'),
  _KindRule(DeviceKind.fan, r'quạt|\bquat\b|\bfan\b'),
  _KindRule(DeviceKind.light, r'đèn|\bden\b|light|lamp|bulb|\bled\b'),
  _KindRule(DeviceKind.socket, r'ổ cắm|o cam|socket|\bplug\b|outlet'),
  _KindRule(DeviceKind.switchGear, r'công tắc|cong tac|switch'),
  _KindRule(DeviceKind.curtain, r'rèm|\brem\b|curtain|blind'),
  _KindRule(DeviceKind.climate, r'điều hòa|điều hoà|dieu hoa|máy lạnh|may lanh|\bac\b|aircon|air con'),
  _KindRule(DeviceKind.sensor, r'cảm biến|cam bien|sensor'),
];

DeviceKind? _kindFromName(String name) {
  DeviceKind? best;
  var bestStart = name.length + 1;
  for (final rule in _nameRules) {
    final match = rule.pattern.firstMatch(name);
    if (match != null && match.start < bestStart) {
      best = rule.kind;
      bestStart = match.start;
    }
  }
  return best;
}
