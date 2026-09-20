import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/features/devices/device_summary.dart';
import 'package:tieu_home/models/device.dart';

Device device(String id, {bool? online}) =>
    Device(id: id, nativeId: id, protocol: 'x', online: online);

void main() {
  group('DeviceSummary', () {
    test('counts online, offline and unknown from the list it is given', () {
      final summary = DeviceSummary.of([
        device('a', online: true),
        device('b', online: true),
        device('c', online: false),
        device('d'),
      ]);

      expect(summary.total, 4);
      expect(summary.online, 2);
      expect(summary.offline, 1);
      expect(summary.unknown, 1);
      expect(summary.needAttention, 2);
      expect(summary.allOnline, isFalse);
      expect(summary.overview, '2 thiết bị cần chú ý');
    });

    test('works for any number of devices, not a fixed one', () {
      for (final count in [1, 5, 12, 40]) {
        final summary = DeviceSummary.of([
          for (var i = 0; i < count; i++) device('d$i', online: i.isEven),
        ]);
        expect(summary.total, count);
        expect(summary.online + summary.offline + summary.unknown, count);
        expect(summary.online, (count / 2).ceil());
      }
    });

    test('when every device is online the overview says so', () {
      final summary = DeviceSummary.of([device('a', online: true), device('b', online: true)]);

      expect(summary.allOnline, isTrue);
      expect(summary.needAttention, 0);
      expect(summary.overview, 'Mọi thiết bị đều đang trực tuyến');
    });

    test('an empty list is nothing, and not "all online"', () {
      final summary = DeviceSummary.of(const <Device>[]);

      expect(summary.total, 0);
      expect(summary.allOnline, isFalse);
    });
  });

  group('greetingFor', () {
    final cases = <int, String>{
      0: 'Chào buổi tối',
      4: 'Chào buổi tối',
      5: 'Chào buổi sáng',
      10: 'Chào buổi sáng',
      11: 'Chào buổi trưa',
      12: 'Chào buổi trưa',
      13: 'Chào buổi chiều',
      17: 'Chào buổi chiều',
      18: 'Chào buổi tối',
      23: 'Chào buổi tối',
    };

    cases.forEach((hour, greeting) {
      test('$hour:30 is "$greeting"', () {
        expect(greetingFor(DateTime(2026, 9, 20, hour, 30)), greeting);
      });
    });
  });
}
