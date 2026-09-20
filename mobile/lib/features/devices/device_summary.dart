import '../../models/device.dart';

/// How many devices there are and how many are reachable: the numbers behind
/// the summary at the top of the home screen. Computed from the list the Hub
/// returned; nothing is fixed or remembered.
class DeviceSummary {
  const DeviceSummary({
    required this.total,
    required this.online,
    required this.offline,
    required this.unknown,
  });

  factory DeviceSummary.of(Iterable<Device> devices) {
    var online = 0;
    var offline = 0;
    var unknown = 0;
    for (final device in devices) {
      switch (device.onlineState) {
        case OnlineState.online:
          online++;
        case OnlineState.offline:
          offline++;
        case OnlineState.unknown:
          unknown++;
      }
    }
    return DeviceSummary(
      total: online + offline + unknown,
      online: online,
      offline: offline,
      unknown: unknown,
    );
  }

  final int total;
  final int online;
  final int offline;

  /// Devices whose online state the Hub did not report.
  final int unknown;

  /// Devices that are offline or whose state is unknown.
  int get needAttention => offline + unknown;

  bool get allOnline => total > 0 && needAttention == 0;

  /// One line about the whole home, for under the title.
  String get overview =>
      allOnline ? 'Mọi thiết bị đều đang trực tuyến' : '$needAttention thiết bị cần chú ý';
}

/// The greeting for [time] (local time of the phone).
String greetingFor(DateTime time) {
  final hour = time.hour;
  if (hour >= 5 && hour < 11) return 'Chào buổi sáng';
  if (hour >= 11 && hour < 13) return 'Chào buổi trưa';
  if (hour >= 13 && hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}
