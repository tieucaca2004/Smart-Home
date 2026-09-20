import 'package:flutter/material.dart';

/// The heading of a block of a screen ("Thiết bị", "Điều khiển"), with an
/// optional action at its end.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});

  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Text(text, style: Theme.of(context).textTheme.titleMedium)),
        ?trailing,
      ],
    );
  }
}
