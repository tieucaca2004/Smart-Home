import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/features/devices/labels/function_labels.dart';
import 'package:tieu_home/models/device_capabilities.dart';

DeviceFunction fn(String code, {String? name, String type = 'Boolean'}) {
  return DeviceFunction(code: code, type: type, name: name);
}

final RegExp han = RegExp('[⺀-鿿]');

void main() {
  group('Chinese vendor labels become Vietnamese', () {
    test('开关1 / 开关2 / 开关3 -> Công tắc 1 / 2 / 3', () {
      expect(functionLabel(fn('switch_1', name: '开关1')), 'Công tắc 1');
      expect(functionLabel(fn('switch_2', name: '开关2')), 'Công tắc 2');
      expect(functionLabel(fn('switch_3', name: '开关3')), 'Công tắc 3');
    });

    test('the number is carried over whatever it is, with or without a space', () {
      expect(functionLabel(fn('switch_7', name: '开关7')), 'Công tắc 7');
      expect(functionLabel(fn('switch_12', name: '开关 12')), 'Công tắc 12');
      expect(functionLabel(fn('switch', name: '开关')), 'Công tắc');
    });

    test('traditional characters and countdown timers are understood too', () {
      expect(functionLabel(fn('switch_3', name: '開關3')), 'Công tắc 3');
      expect(functionLabel(fn('countdown_1', name: '倒计时1', type: 'Integer')), 'Đếm ngược 1');
      expect(functionLabel(fn('countdown_2', name: '倒計時2', type: 'Integer')), 'Đếm ngược 2');
    });

    test('friendlyFunctionLabel is the same Vietnamese label', () {
      expect(friendlyFunctionLabel(fn('switch_1', name: '开关1')), 'Công tắc 1');
    });
  });

  group('fallback rule when there is no friendly label', () {
    test('switch_1 -> Công tắc 1, switch_2 -> Công tắc 2, switch_3 -> Công tắc 3', () {
      expect(functionLabel(fn('switch_1')), 'Công tắc 1');
      expect(functionLabel(fn('switch_2')), 'Công tắc 2');
      expect(functionLabel(fn('switch_3')), 'Công tắc 3');
    });

    test('does not assume three switches: any N works', () {
      expect(functionLabel(fn('switch_4')), 'Công tắc 4');
      expect(functionLabel(fn('switch_10')), 'Công tắc 10');
      expect(friendlyFunctionLabel(fn('switch_6')), 'Công tắc 6');
    });

    test('the code is matched case-insensitively', () {
      expect(functionLabel(fn('SWITCH_2')), 'Công tắc 2');
    });

    test('a name that only restates the code adds nothing, so the rule applies', () {
      expect(functionLabel(fn('switch_1', name: 'Switch 1')), 'Công tắc 1');
      expect(functionLabel(fn('switch_2', name: 'switch_2')), 'Công tắc 2');
    });

    test('an unknown Chinese name is never shown; the rule on the code is used', () {
      final label = functionLabel(fn('switch_2', name: '未知功能'));
      expect(label, 'Công tắc 2');
      expect(han.hasMatch(label), isFalse);
    });

    test('an unknown Chinese name on an unknown code falls back to the readable code', () {
      final label = functionLabel(fn('mode', name: '模式', type: 'Enum'));
      expect(label, 'Mode');
      expect(han.hasMatch(label), isFalse);
      expect(friendlyFunctionLabel(fn('mode', name: '模式', type: 'Enum')), isNull);
    });

    test('other codes keep the readable-code fallback', () {
      expect(functionLabel(fn('relay_a')), 'Relay a');
      expect(friendlyFunctionLabel(fn('relay_a')), isNull);
      // Only numbered switch_N codes follow the rule.
      expect(functionLabel(fn('switch_led')), 'Switch led');
      expect(friendlyFunctionLabel(fn('switch_led')), isNull);
    });
  });

  group('names the Hub already gives in a readable script', () {
    test('a Vietnamese name is kept as it is', () {
      expect(functionLabel(fn('night_light', name: 'Đèn ngủ')), 'Đèn ngủ');
      expect(functionLabel(fn('mode', name: 'Chế độ', type: 'Enum')), 'Chế độ');
    });

    test('a Vietnamese name wins over the code rule', () {
      expect(functionLabel(fn('switch_1', name: 'Đèn bếp')), 'Đèn bếp');
    });

    test('surrounding whitespace is ignored', () {
      expect(functionLabel(fn('night_light', name: '  Đèn ngủ ')), 'Đèn ngủ');
    });
  });

  group('technical line', () {
    test('is the code and the type, for secondary text', () {
      expect(functionTechnicalLine(fn('switch_1', name: '开关1')), 'switch_1 · Boolean');
      expect(functionTechnicalLine(fn('countdown_1', type: 'Integer')), 'countdown_1 · Integer');
    });
  });
}
