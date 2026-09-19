import 'package:flutter/foundation.dart';

import '../../models/device.dart';

/// Where the names a person gives their devices are kept.
///
/// The name the Hub reports ([Device.displayName], e.g. `W-W603 2`) is always
/// the default. A custom name (`Công tắc phòng khách`) only replaces what is
/// *shown*: the device's id is never changed, and every Hub request keeps
/// using it. Screens depend on this interface only, so where the names are
/// stored can change later (a file on the phone, then the Hub itself) without
/// touching them.
abstract interface class DeviceNameStore implements Listenable {
  /// The custom name for the device with Hub id [deviceId]; null when it has none.
  String? customNameOf(String deviceId);

  /// Sets the custom name, or removes it when [name] is null or blank.
  Future<void> setCustomName(String deviceId, String? name);
}

/// Keeps custom names in memory for the life of the app process. It is the
/// default; a persistent store is a drop-in replacement.
class InMemoryDeviceNameStore extends ChangeNotifier implements DeviceNameStore {
  final Map<String, String> _names = <String, String>{};

  @override
  String? customNameOf(String deviceId) => _names[deviceId];

  @override
  Future<void> setCustomName(String deviceId, String? name) async {
    final trimmed = name?.trim();
    if (trimmed == null || trimmed.isEmpty) {
      if (_names.remove(deviceId) != null) notifyListeners();
      return;
    }
    if (_names[deviceId] == trimmed) return;
    _names[deviceId] = trimmed;
    notifyListeners();
  }
}

/// The name to show for [device]: its custom name when [store] has one,
/// otherwise the name the Hub reports.
String deviceDisplayName(Device device, DeviceNameStore? store) {
  return store?.customNameOf(device.id) ?? device.displayName;
}
