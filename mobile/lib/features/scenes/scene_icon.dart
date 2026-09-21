import 'package:flutter/material.dart';

import '../../models/scene.dart';

/// The icon (and its Vietnamese label) for each key in [sceneIconKeys].
///
/// Purely presentational — kept in lockstep with the Hub's
/// `SCENE_ICONS` (`src/services/sceneService.js`) by key, but this file has
/// no knowledge of the Hub or of any device; it only draws what a scene's
/// `icon` string says.
enum SceneIcon {
  powerOn('power-on', 'Bật', Icons.power_rounded),
  powerOff('power-off', 'Tắt', Icons.power_off_rounded),
  sun('sun', 'Ban ngày', Icons.wb_sunny_rounded),
  moon('moon', 'Ban đêm', Icons.dark_mode_rounded),
  home('home', 'Ở nhà', Icons.home_rounded),
  custom('custom', 'Khác', Icons.auto_awesome_rounded);

  const SceneIcon(this.key, this.label, this.icon);

  /// The key stored on [Scene.icon] / sent to the Hub.
  final String key;

  final String label;
  final IconData icon;

  /// The entry for [key], or [custom] when it is not one of [sceneIconKeys].
  static SceneIcon fromKey(String key) {
    for (final value in values) {
      if (value.key == key) return value;
    }
    return custom;
  }
}
