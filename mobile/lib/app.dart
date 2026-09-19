import 'package:flutter/material.dart';

import 'data/hub_api_client.dart';
import 'features/devices/device_list_screen.dart';

const String appTitle = 'Tiểu Home';

ThemeData _theme(Brightness brightness) => ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal, brightness: brightness),
    );

/// The app shell. The first screen is the device list.
class TieuHomeApp extends StatelessWidget {
  const TieuHomeApp({super.key, required this.client});

  final HubApiClient client;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: appTitle,
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      home: DeviceListScreen(client: client),
    );
  }
}

/// Shown instead of the app when `HUB_BASE_URL` is set to something unusable,
/// so the developer sees what to fix rather than a blank screen.
class ConfigErrorApp extends StatelessWidget {
  const ConfigErrorApp({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: appTitle,
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      home: Scaffold(
        appBar: AppBar(title: const Text('Cấu hình sai')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: SelectableText(message),
        ),
      ),
    );
  }
}
