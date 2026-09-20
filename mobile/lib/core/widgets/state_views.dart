import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// Centered spinner shown while a screen or section is loading, with an
/// optional line saying what is loading.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.compact = false, this.message});

  /// Inline (inside a scrolling list) rather than filling the screen.
  final bool compact;

  final String? message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(
          width: 32,
          height: 32,
          child: CircularProgressIndicator(strokeWidth: 3),
        ),
        if (message != null) ...[
          const SizedBox(height: AppSpacing.md),
          Text(
            message!,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ],
    );
    return compact
        ? Padding(padding: const EdgeInsets.all(AppSpacing.xl), child: Center(child: content))
        : Center(child: content);
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
    final scheme = theme.colorScheme;
    final content = Padding(
      padding: EdgeInsets.all(compact ? AppSpacing.lg : AppSpacing.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _IconBubble(
            icon: Icons.cloud_off_rounded,
            background: scheme.errorContainer,
            foreground: scheme.onErrorContainer,
            size: compact ? 48 : 64,
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
          const SizedBox(height: AppSpacing.sm),
          Text(
            hint,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
          if (detail != null) ...[
            const SizedBox(height: AppSpacing.sm),
            SelectableText(
              detail!,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline),
            ),
          ],
          const SizedBox(height: AppSpacing.xl),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
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
    final scheme = theme.colorScheme;
    return Center(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _IconBubble(
                icon: Icons.devices_other_rounded,
                background: scheme.primaryContainer,
                foreground: scheme.onPrimaryContainer,
                size: 64,
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              Text(
                hint,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: AppSpacing.xl),
              OutlinedButton.icon(
                onPressed: onReload,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Tải lại'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A round tinted badge holding one icon: the illustration of a state view.
class _IconBubble extends StatelessWidget {
  const _IconBubble({
    required this.icon,
    required this.background,
    required this.foreground,
    required this.size,
  });

  final IconData icon;
  final Color background;
  final Color foreground;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: background, shape: BoxShape.circle),
      child: Icon(icon, size: size * 0.5, color: foreground),
    );
  }
}
