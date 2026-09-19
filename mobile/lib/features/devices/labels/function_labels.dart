import '../../../models/device_capabilities.dart';

/// Vietnamese wording for a device's commands and statuses.
///
/// The Hub passes the vendor's own `name` through, and that is often Chinese
/// (`开关1`). People should never have to read that, and should not need to
/// know a code such as `switch_1` either. Everything here is a pure function
/// of one [DeviceFunction]: nothing assumes a device has a fixed number of
/// switches, or any particular code.
///
/// Order of preference for the label:
///
/// 1. a Chinese name made of a known term plus an optional number
///    (`开关1` becomes `Công tắc 1`);
/// 2. a name the Hub gives that contains no Chinese/Japanese/Korean text and is
///    not just the code spelled differently (`Đèn ngủ` is kept as it is);
/// 3. a rule on the code (`switch_N` becomes `Công tắc N`);
/// 4. the code made readable (`relay_a` becomes `Relay a`).
///
/// The technical code and type stay available through [functionTechnicalLine],
/// for showing as secondary text.
String? friendlyFunctionLabel(DeviceFunction function) {
  final name = function.name?.trim();
  if (name != null && name.isNotEmpty) {
    final translated = _translateKnownTerm(name);
    if (translated != null) return translated;
    if (!_containsCjk(name) && !_isCodeLike(name, function.code)) return name;
  }
  return _labelFromCode(function.code);
}

/// The label to show as the main text of a control: [friendlyFunctionLabel],
/// or the code made readable when there is nothing friendlier.
String functionLabel(DeviceFunction function) {
  return friendlyFunctionLabel(function) ?? _readableCode(function.code);
}

/// The technical identity of a function, for secondary text: `switch_1 · Boolean`.
String functionTechnicalLine(DeviceFunction function) {
  return '${function.code} · ${function.type}';
}

/// Chinese terms that appear in vendor names, and their Vietnamese wording.
/// A trailing number is carried over (`开关2` becomes `Công tắc 2`).
const Map<String, String> _knownTerms = <String, String>{
  '开关': 'Công tắc',
  '開關': 'Công tắc',
  '倒计时': 'Đếm ngược',
  '倒計時': 'Đếm ngược',
};

/// A term followed by an optional number: `开关1`, `开关 2`, `开关`.
final RegExp _nameWithNumber = RegExp(r'^(.*?)\s*(\d+)?$');

String? _translateKnownTerm(String name) {
  final match = _nameWithNumber.firstMatch(name);
  if (match == null) return null;
  final term = _knownTerms[match.group(1)!.trim()];
  if (term == null) return null;
  final number = match.group(2);
  return number == null ? term : '$term $number';
}

/// Han, kana, hangul and their punctuation / full-width forms.
final RegExp _cjk = RegExp('[⺀-鿿가-힯豈-﫿＀-￯]');

bool _containsCjk(String text) => _cjk.hasMatch(text);

final RegExp _separators = RegExp(r'[\s_\-]+');

String _squash(String text) => text.toLowerCase().replaceAll(_separators, '');

/// A name that only restates the code (`Switch 1` for `switch_1`) says
/// nothing friendlier than the code does.
bool _isCodeLike(String name, String code) => _squash(name) == _squash(code);

final RegExp _switchCode = RegExp(r'^switch_(\d+)$', caseSensitive: false);

String? _labelFromCode(String code) {
  final match = _switchCode.firstMatch(code);
  return match == null ? null : 'Công tắc ${match.group(1)}';
}

String _readableCode(String code) {
  final words = code.replaceAll('_', ' ').trim();
  if (words.isEmpty) return code;
  return '${words[0].toUpperCase()}${words.substring(1)}';
}
