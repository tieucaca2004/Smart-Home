import 'package:flutter/material.dart';

import '../data/hub_api_client.dart' show HubApiClient;
import 'devices/device_list_screen.dart';
import 'devices/device_name_store.dart';
import 'scenes/scenes_home_screen.dart';

/// The app's two areas: "Thiết bị" (unchanged since Sprint 4) and "Ngữ cảnh"
/// (Sprint 5: scenes and automations), switched with a bottom navigation bar.
///
/// Deliberately not a second [Scaffold] wrapping [DeviceListScreen]: that
/// screen owns its own Scaffold (and every Sprint 2–4B test that pumps
/// [DeviceListScreen]/`TieuHomeApp` and looks for `find.byType(Scaffold)`
/// expects exactly one). The bottom bar sits below the active tab instead,
/// in a plain [Column] with no Scaffold of its own.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.client, this.nameStore});

  final HubApiClient client;
  final DeviceNameStore? nameStore;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    // Built on demand (not an IndexedStack) so the inactive tab's screen
    // never mounts, never calls its own initState, and never issues a
    // request no test on the active tab expects to see. Its own state (scroll
    // position, in-flight edits) does not survive switching tabs — an
    // acceptable MVP trade-off for a screen with no scenes/automations
    // editor open across a tab switch.
    final content = switch (_index) {
      0 => DeviceListScreen(client: widget.client, nameStore: widget.nameStore),
      _ => ScenesHomeScreen(client: widget.client),
    };
    return Column(
      children: [
        Expanded(child: content),
        SafeArea(
          top: false,
          child: NavigationBar(
            selectedIndex: _index,
            onDestinationSelected: (index) => setState(() => _index = index),
            // Labels name the *screen* ("Trang chủ", "Ngữ cảnh"), deliberately not
            // "Thiết bị" — that text (and devices_other_rounded, the generic
            // device icon) already appear inside DeviceListScreen itself, and a
            // second on-screen match would break its `find.text`/`find.byIcon`
            // tests, which assume exactly one.
            destinations: const [
              NavigationDestination(icon: Icon(Icons.home_rounded), label: 'Trang chủ'),
              NavigationDestination(icon: Icon(Icons.auto_awesome_rounded), label: 'Ngữ cảnh'),
            ],
          ),
        ),
      ],
    );
  }
}
