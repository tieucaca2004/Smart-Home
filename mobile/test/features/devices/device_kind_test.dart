import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/features/devices/device_kind.dart';
import 'package:tieu_home/models/device.dart';

// Sprint 4: the icon and the type name on a device card are a presentation
// mapping of what the Hub reports (category, name). It must never break on
// something it does not know.

Device device({String? category, String? name}) =>
    Device(id: 'x:1', nativeId: '1', protocol: 'x', category: category, name: name);

void main() {
  group('from the category', () {
    const cases = <String, DeviceKind>{
      'kg': DeviceKind.switchGear,
      'dj': DeviceKind.light,
      'cz': DeviceKind.socket,
      'fs': DeviceKind.fan,
      'mcs': DeviceKind.door,
      'cl': DeviceKind.curtain,
      'kt': DeviceKind.climate,
      'wsdcg': DeviceKind.sensor,
      'bx': DeviceKind.fridge,
      'wnykq': DeviceKind.remote,
      // Descriptive words, as another protocol may report them.
      'light': DeviceKind.light,
      'switch': DeviceKind.switchGear,
      'door_sensor': DeviceKind.door,
      'refrigerator': DeviceKind.fridge,
      'freezer': DeviceKind.fridge,
      'infrared_tv': DeviceKind.remote,
    };

    cases.forEach((category, kind) {
      test('"$category" is ${kind.name}', () {
        expect(deviceKindOf(device(category: category)), kind);
      });
    });

    test('an infrared remote that controls a light or an air conditioner is still a remote', () {
      expect(deviceKindOf(device(category: 'infrared_light')), DeviceKind.remote);
      expect(deviceKindOf(device(category: 'infrared_ac')), DeviceKind.remote);
    });

    test('case and surrounding spaces do not matter', () {
      expect(deviceKindOf(device(category: ' KG ')), DeviceKind.switchGear);
      expect(deviceKindOf(device(category: 'Light')), DeviceKind.light);
    });

    test('a short vendor code only matches as a whole, never inside another code', () {
      expect(deviceKindOf(device(category: 'kgx')), DeviceKind.generic);
      expect(deviceKindOf(device(category: 'xdjx')), DeviceKind.generic);
    });
  });

  group('from the name, when the category does not say', () {
    const cases = <String, DeviceKind>{
      'Tủ lạnh': DeviceKind.fridge,
      'Tủ đông phòng bếp': DeviceKind.fridge,
      'Cửa chính': DeviceKind.door,
      'Khóa cổng': DeviceKind.door,
      'Đèn phòng khách': DeviceKind.light,
      'Quạt trần': DeviceKind.fan,
      'Ổ cắm bếp': DeviceKind.socket,
      'Công tắc phòng ngủ': DeviceKind.switchGear,
      'Rèm phòng khách': DeviceKind.curtain,
      'Điều hòa phòng ngủ': DeviceKind.climate,
      'Cảm biến nhiệt độ': DeviceKind.sensor,
      'Bộ điều khiển hồng ngoại': DeviceKind.remote,
      'IR phòng khách': DeviceKind.remote,
      'Living room light': DeviceKind.light,
      'Front DOOR': DeviceKind.door,
      // Names typed without accents.
      'den ngu': DeviceKind.light,
      'cong tac bep': DeviceKind.switchGear,
    };

    cases.forEach((name, kind) {
      test('"$name" is ${kind.name}', () {
        expect(deviceKindOf(device(name: name)), kind);
      });
    });

    test('the noun that comes first decides ("Công tắc đèn" is a switch)', () {
      expect(deviceKindOf(device(name: 'Công tắc đèn')), DeviceKind.switchGear);
      expect(deviceKindOf(device(name: 'Đèn cửa')), DeviceKind.light);
      expect(deviceKindOf(device(name: 'Cảm biến cửa')), DeviceKind.sensor);
    });

    test('a word that only looks like one does not match ("của" is "of", not "cửa")', () {
      expect(deviceKindOf(device(name: 'Phòng của bé')), DeviceKind.generic);
    });
  });

  group('priority and fallback', () {
    test('a category the app knows wins over the name', () {
      expect(deviceKindOf(device(category: 'kg', name: 'Đèn bếp')), DeviceKind.switchGear);
    });

    test('an unknown category falls back to the name', () {
      expect(deviceKindOf(device(category: 'zzz', name: 'Quạt')), DeviceKind.fan);
    });

    test('nothing recognisable is a generic device, not an error', () {
      expect(deviceKindOf(device()), DeviceKind.generic);
      expect(deviceKindOf(device(category: '', name: '  ')), DeviceKind.generic);
      expect(deviceKindOf(device(category: 'zzz', name: 'W-W603 2')), DeviceKind.generic);
    });

    test('a device whose lookup failed (no name, no category) is generic', () {
      const broken = Device(id: 'x:2', nativeId: '2', protocol: 'x', error: 'lookup failed');
      expect(deviceKindOf(broken), DeviceKind.generic);
    });
  });

  group('the kinds themselves', () {
    test('every kind has its own icon and its own Vietnamese label', () {
      final icons = DeviceKind.values.map((k) => k.icon.codePoint).toSet();
      final labels = DeviceKind.values.map((k) => k.label).toSet();
      expect(icons, hasLength(DeviceKind.values.length), reason: 'icons must differ');
      expect(labels, hasLength(DeviceKind.values.length), reason: 'labels must differ');
      for (final kind in DeviceKind.values) {
        expect(kind.label.trim(), isNotEmpty, reason: kind.name);
      }
    });
  });
}
