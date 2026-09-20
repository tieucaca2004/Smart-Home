import 'package:flutter/material.dart';

import 'core/branding.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/app_tokens.dart';
import 'data/hub_api_client.dart';
import 'features/devices/device_list_screen.dart';
import 'features/devices/device_name_store.dart';

/// The app shell. The first screen is the device list.
///
/// [nameStore] is where the names people give their devices live; leave it
/// out and every device shows the name the Hub reports.
class TieuHomeApp extends StatelessWidget {
  const TieuHomeApp({super.key, required this.client, this.nameStore});

  final HubApiClient client;
  final DeviceNameStore? nameStore;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: appTitle,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      home: DeviceListScreen(client: client, nameStore: nameStore),
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
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      home: Scaffold(
        appBar: AppBar(title: const Text('Cấu hình sai')),
        body: Padding(
          padding: const EdgeInsets.all(AppSpacing.screen),
          child: SelectableText(message),
        ),
      ),
    );
  }
}
