/// Response bodies shaped exactly like the Hub's (see the backend
/// `src/routes/devices.js` and `DeviceService`).
library;

const String switchDeviceId = 'tuya:1638018234ab950e1ecd';
const String lampDeviceId = 'matter:abc123';
const String brokenDeviceId = 'tuya:broken';

/// `GET /api/devices`: a healthy device, one from another protocol, and one
/// whose lookup failed (identity + `error` only).
Map<String, Object?> devicesBody() => {
      'devices': [
        {
          'id': switchDeviceId,
          'nativeId': '1638018234ab950e1ecd',
          'protocol': 'tuya',
          'name': 'W-W603 2',
          'category': 'kg',
          'online': true,
        },
        {
          'id': lampDeviceId,
          'nativeId': 'abc123',
          'protocol': 'matter',
          'name': 'Đèn phòng khách',
          'category': 'light',
          'online': false,
        },
        {
          'id': brokenDeviceId,
          'nativeId': 'broken',
          'protocol': 'tuya',
          'error': 'Upstream lookup failed',
        },
      ],
    };

/// `GET /api/devices/:id/capabilities` for the three-gang switch.
Map<String, Object?> switchCapabilitiesBody() => {
      'id': switchDeviceId,
      'capabilities': {
        'id': switchDeviceId,
        'protocol': 'tuya',
        'nativeId': '1638018234ab950e1ecd',
        'name': 'W-W603 2',
        'category': 'kg',
        'online': true,
        'commands': [
          {'code': 'switch_1', 'type': 'Boolean', 'values': <String, Object?>{}},
          {
            'code': 'countdown_1',
            'type': 'Integer',
            'values': {'min': 0, 'max': 86400, 'scale': 0, 'step': 1, 'unit': 's'},
          },
          {
            'code': 'mode',
            'type': 'Enum',
            'name': 'Chế độ',
            'values': {
              'range': ['cold', 'hot'],
            },
          },
        ],
        'statuses': [
          {'code': 'switch_1', 'type': 'Boolean', 'values': <String, Object?>{}},
        ],
      },
    };

/// The real device on the Hub: three switches and three countdown timers.
const String realDeviceId = switchDeviceId;

const Map<String, Object?> _countdownValues = {
  'min': 0,
  'max': 86400,
  'scale': 0,
  'step': 1,
  'unit': 's',
};

/// A `GET /api/devices/:id/capabilities` body for any device.
Map<String, Object?> capabilitiesBody(
  String id, {
  String protocol = 'tuya',
  String? name,
  bool? online,
  List<Map<String, Object?>> commands = const [],
}) {
  final nativeId = id.substring(id.indexOf(':') + 1);
  return {
    'id': id,
    'capabilities': {
      'id': id,
      'protocol': protocol,
      'nativeId': nativeId,
      'name': ?name,
      'online': ?online,
      'commands': commands,
      'statuses': [
        for (final command in commands) {...command},
      ],
    },
  };
}

/// Capabilities of the real W-W603 2: `switch_1..3` (Boolean) and
/// `countdown_1..3` (Integer, 0-86400).
Map<String, Object?> realDeviceCapabilitiesBody({bool? online = true}) {
  return capabilitiesBody(
    realDeviceId,
    name: 'W-W603 2',
    online: online,
    commands: [
      for (final n in [1, 2, 3])
        {'code': 'switch_$n', 'type': 'Boolean', 'values': <String, Object?>{}},
      for (final n in [1, 2, 3])
        {'code': 'countdown_$n', 'type': 'Integer', 'values': _countdownValues},
    ],
  );
}
