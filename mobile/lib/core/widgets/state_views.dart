import 'package:flutter/material.dart';

/// Centered spinner shown while a screen or section is loading.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.compact = false});

  /// Inline (inside a scrolling list) rather than filling the screen.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    const spinner = Center(child: CircularProgressIndicator());
    return compact
        ? const Padding(padding: EdgeInsets.all(24), child: spinner)
        : spinner;
  }
}

/// A clear error with a retry button.
class ErrorView extends StatelessWidget {
  const ErrorView({
    super.key,
    required this.title,
    required this.hint,
    required this.onRetry,
    this.detail,
    this.compact = false,
  });

  final String title;
  final String hint;
  final String? detail;
  final VoidCallback onRetry;

  /// Inline (inside a scrolling list) rather than filling the screen.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final content = Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_off_outlined, size: compact ? 32 : 48, color: theme.colorScheme.error),
          const SizedBox(height: 12),
          Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(hint, textAlign: TextAlign.center),
          if (detail != null) ...[
            const SizedBox(height: 8),
            SelectableText(
              detail!,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Thử lại'),
          ),
        ],
      ),
    );
    return compact ? content : Center(child: SingleChildScrollView(child: content));
  }
}

/// "Nothing here" state with a reload button.
class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.title,
    required this.hint,
    required this.onReload,
  });

  final String title;
  final String hint;
  final VoidCallback onReload;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.devices_other_outlined, size: 48, color: theme.colorScheme.outline),
              const SizedBox(height: 12),
              Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(hint, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: onReload,
                icon: const Icon(Icons.refresh),
                label: const Text('Tải lại'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
