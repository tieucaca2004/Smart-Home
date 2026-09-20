import 'package:flutter_test/flutter_test.dart';

/// Opens the "Thông tin kỹ thuật" card of a device screen.
///
/// Since Sprint 4 that card starts folded, so the controls are the first thing
/// on the screen and the technical details do not compete with them. A test
/// that checks a technical detail (the device id, the category, the commands
/// and statuses the device lists) opens the card first.
Future<void> expandTechnicalInfo(WidgetTester tester) async {
  await tester.tap(find.text('Thông tin kỹ thuật'));
  await tester.pumpAndSettle();
}
