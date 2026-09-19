import 'package:flutter/material.dart';

import 'app.dart';
import 'config/hub_config.dart';
import 'data/hub_api_client.dart';

void main() {
  runApp(_buildApp());
}

Widget _buildApp() {
  try {
    final config = HubConfig.current();
    return TieuHomeApp(client: HubApiClient(baseUrl: config.baseUrl));
  } on FormatException catch (e) {
    return ConfigErrorApp(message: e.message);
  }
}
