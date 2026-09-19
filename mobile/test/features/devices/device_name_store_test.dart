import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/features/devices/device_name_store.dart';
import 'package:tieu_home/models/device.dart';

const Device switchDevice = Device(
  id: 'tuya:1638018234ab950e1ecd',
  nativeId: '1638018234ab950e1ecd',
  protocol: 'tuya',
  name: 'W-W603 2',
  category: 'kg',
  online: true,
);

const Device otherDevice = Device(
  id: 'tuya:other',
  nativeId: 'other',
  protocol: 'tuya',
  name: 'Ổ cắm',
);

void main() {
  group('deviceDisplayName', () {
    test('defaults to the name the Hub reports', () {
      final store = InMemoryDeviceNameStore();

      expect(deviceDisplayName(switchDevice, store), 'W-W603 2');
      expect(deviceDisplayName(switchDevice, null), 'W-W603 2');
    });

    test('falls back to the native id when the Hub gives no name', () {
      const unnamed = Device(id: 'tuya:abc', nativeId: 'abc', protocol: 'tuya');

      expect(deviceDisplayName(unnamed, InMemoryDeviceNameStore()), 'abc');
    });

    test('a custom name replaces what is shown, and nothing else about the device', () async {
      final store = InMemoryDeviceNameStore();

      await store.setCustomName(switchDevice.id, 'Công tắc phòng khách');

      expect(deviceDisplayName(switchDevice, store), 'Công tắc phòng khách');
      // The device itself: same id, same Hub name.
      expect(switchDevice.id, 'tuya:1638018234ab950e1ecd');
      expect(switchDevice.nativeId, '1638018234ab950e1ecd');
      expect(switchDevice.displayName, 'W-W603 2');
    });

    test('a custom name only applies to its own device', () async {
      final store = InMemoryDeviceNameStore();

      await store.setCustomName(switchDevice.id, 'Đèn bếp');

      expect(deviceDisplayName(otherDevice, store), 'Ổ cắm');
      expect(store.customNameOf(otherDevice.id), isNull);
    });
  });

  group('InMemoryDeviceNameStore', () {
    test('trims the name', () async {
      final store = InMemoryDeviceNameStore();

      await store.setCustomName(switchDevice.id, '  Đèn bếp  ');

      expect(store.customNameOf(switchDevice.id), 'Đèn bếp');
    });

    test('a blank or null name removes the custom name', () async {
      final store = InMemoryDeviceNameStore();
      await store.setCustomName(switchDevice.id, 'Đèn bếp');

      await store.setCustomName(switchDevice.id, '   ');
      expect(store.customNameOf(switchDevice.id), isNull);
      expect(deviceDisplayName(switchDevice, store), 'W-W603 2');

      await store.setCustomName(switchDevice.id, 'Đèn bếp');
      await store.setCustomName(switchDevice.id, null);
      expect(store.customNameOf(switchDevice.id), isNull);
    });

    test('notifies listeners only when something changed', () async {
      final store = InMemoryDeviceNameStore();
      var notified = 0;
      store.addListener(() => notified++);

      await store.setCustomName(switchDevice.id, 'Đèn bếp');
      expect(notified, 1);

      await store.setCustomName(switchDevice.id, 'Đèn bếp');
      expect(notified, 1, reason: 'same name again');

      await store.setCustomName(switchDevice.id, 'Đèn phòng ngủ');
      expect(notified, 2);

      await store.setCustomName(switchDevice.id, null);
      expect(notified, 3);

      await store.setCustomName(switchDevice.id, null);
      expect(notified, 3, reason: 'nothing to remove');
    });
  });
}
