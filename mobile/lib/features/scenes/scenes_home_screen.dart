import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/load_controller.dart';
import '../../core/theme/app_palette.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/state_views.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/automation.dart';
import '../../models/scene.dart';
import '../devices/widgets/section_card.dart';
import '../devices/widgets/section_title.dart';
import 'automation_editor_screen.dart';
import 'scene_editor_screen.dart';
import 'scene_icon.dart';

/// "Ngữ cảnh": a scene ("Tắt toàn bộ quán") the person runs with one tap, and
/// an automation ("18:00 mỗi ngày → Mở quán") that runs one for them. This
/// screen lists both, backed by `GET /api/scenes` and `GET /api/automations`.
class ScenesHomeScreen extends StatefulWidget {
  const ScenesHomeScreen({super.key, required this.client});

  final HubApiClient client;

  @override
  State<ScenesHomeScreen> createState() => _ScenesHomeScreenState();
}

class _ScenesPageData {
  const _ScenesPageData({required this.scenes, required this.automations});

  final List<Scene> scenes;
  final List<Automation> automations;
}

class _ScenesHomeScreenState extends State<ScenesHomeScreen> {
  late final LoadController<_ScenesPageData> _controller;
  final Set<String> _executingSceneIds = <String>{};

  @override
  void initState() {
    super.initState();
    _controller = LoadController<_ScenesPageData>(_load)..load();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<_ScenesPageData> _load() async {
    final scenes = await widget.client.fetchScenes();
    final automations = await widget.client.fetchAutomations();
    return _ScenesPageData(scenes: scenes, automations: automations);
  }

  Future<void> _openSceneEditor([Scene? scene]) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => SceneEditorScreen(client: widget.client, scene: scene)),
    );
    if (saved == true) _controller.load();
  }

  Future<void> _openAutomationEditor([Automation? automation]) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => AutomationEditorScreen(client: widget.client, automation: automation)),
    );
    if (saved == true) _controller.load();
  }

  Future<void> _deleteScene(Scene scene) async {
    if (!await _confirmDelete('Xoá cảnh "${scene.name}"?')) return;
    try {
      await widget.client.deleteScene(scene.id);
      _controller.load();
    } on HubApiException catch (e) {
      _showError(e);
    }
  }

  Future<void> _deleteAutomation(Automation automation) async {
    if (!await _confirmDelete('Xoá tự động hoá "${automation.name}"?')) return;
    try {
      await widget.client.deleteAutomation(automation.id);
      _controller.load();
    } on HubApiException catch (e) {
      _showError(e);
    }
  }

  Future<bool> _confirmDelete(String message) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Huỷ')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Xoá')),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _toggleAutomation(Automation automation, bool enabled) async {
    try {
      await widget.client.updateAutomation(
        automation.id,
        name: automation.name,
        enabled: enabled,
        trigger: automation.trigger,
        sceneId: automation.sceneId,
      );
      _controller.load();
    } on HubApiException catch (e) {
      _showError(e);
    }
  }

  Future<void> _runScene(Scene scene) async {
    setState(() => _executingSceneIds.add(scene.id));
    try {
      final result = await widget.client.executeScene(scene.id);
      if (!mounted) return;
      _showExecutionResult(scene, result);
    } on HubApiException catch (e) {
      if (!mounted) return;
      _showError(e);
    } finally {
      if (mounted) setState(() => _executingSceneIds.remove(scene.id));
    }
  }

  void _showExecutionResult(Scene scene, SceneExecutionResult result) {
    final messenger = ScaffoldMessenger.of(context);
    if (result.success) {
      messenger.showSnackBar(SnackBar(content: Text('Đã chạy "${scene.name}".')));
      return;
    }
    final failed = result.failures.length;
    final total = result.results.length;
    messenger.showSnackBar(
      SnackBar(
        content: Text('"${scene.name}" thất bại một phần: $failed/$total hành động không thành công.'),
        duration: const Duration(seconds: 5),
      ),
    );
  }

  void _showError(HubApiException e) {
    final text = describeHubError(e, hubUrl: widget.client.baseUrl);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text.title)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ngữ cảnh')),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: _controller,
          builder: (context, _) => switch (_controller.state) {
            LoadInProgress() => const LoadingView(message: 'Đang tải…'),
            LoadFailure(:final error) => _buildError(error),
            LoadSuccess(:final data) => _buildContent(data),
          },
        ),
      ),
    );
  }

  Widget _buildError(HubApiException error) {
    final text = describeHubError(error, hubUrl: widget.client.baseUrl);
    return ErrorView(title: text.title, hint: text.hint, detail: text.detail, onRetry: _controller.load);
  }

  Widget _buildContent(_ScenesPageData data) {
    return RefreshIndicator(
      onRefresh: _controller.refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpacing.screen, AppSpacing.lg, AppSpacing.screen, AppSpacing.xxl),
        children: [
          SectionTitle(
            'Cảnh',
            trailing: IconButton(
              icon: const Icon(Icons.add_rounded),
              tooltip: 'Thêm cảnh',
              onPressed: () => _openSceneEditor(),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (data.scenes.isEmpty)
            const _EmptyHint(text: 'Chưa có cảnh nào. Nhấn + để tạo cảnh đầu tiên.')
          else
            for (final scene in data.scenes)
              Padding(
                key: ValueKey('scene-${scene.id}'),
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: _SceneCard(
                  scene: scene,
                  running: _executingSceneIds.contains(scene.id),
                  onTap: () => _openSceneEditor(scene),
                  onRun: () => _runScene(scene),
                  onDelete: () => _deleteScene(scene),
                ),
              ),
          const SizedBox(height: AppSpacing.xl),
          SectionTitle(
            'Tự động hoá',
            trailing: IconButton(
              icon: const Icon(Icons.add_rounded),
              tooltip: 'Thêm tự động hoá',
              onPressed: data.scenes.isEmpty ? null : () => _openAutomationEditor(),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (data.automations.isEmpty)
            _EmptyHint(
              text: data.scenes.isEmpty
                  ? 'Cần có ít nhất một cảnh trước khi tạo tự động hoá.'
                  : 'Chưa có tự động hoá nào. Nhấn + để tạo.',
            )
          else
            for (final automation in data.automations)
              Padding(
                key: ValueKey('automation-${automation.id}'),
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: _AutomationCard(
                  automation: automation,
                  sceneName: _sceneName(data.scenes, automation.sceneId),
                  onTap: () => _openAutomationEditor(automation),
                  onDelete: () => _deleteAutomation(automation),
                  onToggle: (v) => _toggleAutomation(automation, v),
                ),
              ),
        ],
      ),
    );
  }

  String _sceneName(List<Scene> scenes, String sceneId) {
    for (final s in scenes) {
      if (s.id == sceneId) return s.name;
    }
    return sceneId;
  }
}

class _EmptyHint extends StatelessWidget {
  const _EmptyHint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SectionCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Text(
        text,
        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
    );
  }
}

/// One scene: its icon, name, how many actions it has, a run button and (on
/// tap elsewhere on the card) the editor.
class _SceneCard extends StatelessWidget {
  const _SceneCard({
    required this.scene,
    required this.running,
    required this.onTap,
    required this.onRun,
    required this.onDelete,
  });

  final Scene scene;
  final bool running;
  final VoidCallback onTap;
  final VoidCallback onRun;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final icon = SceneIcon.fromKey(scene.icon);
    return SectionCard(
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xs),
        leading: CircleAvatar(
          backgroundColor: scheme.primaryContainer,
          foregroundColor: scheme.onPrimaryContainer,
          child: Icon(icon.icon),
        ),
        title: Text(scene.name, style: theme.textTheme.titleMedium),
        subtitle: Text(
          '${scene.actions.length} hành động',
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (running)
              const Padding(
                padding: EdgeInsets.all(AppSpacing.sm),
                child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5)),
              )
            else
              IconButton(
                key: ValueKey('run-scene-${scene.id}'),
                icon: const Icon(Icons.play_circle_fill_rounded),
                tooltip: 'Chạy cảnh',
                onPressed: onRun,
              ),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded),
              tooltip: 'Xoá cảnh',
              onPressed: onDelete,
            ),
          ],
        ),
      ),
    );
  }
}

/// One automation: name, its daily time and the scene it runs, an
/// enabled/disabled switch, and (on tap elsewhere on the card) the editor.
class _AutomationCard extends StatelessWidget {
  const _AutomationCard({
    required this.automation,
    required this.sceneName,
    required this.onTap,
    required this.onDelete,
    required this.onToggle,
  });

  final Automation automation;
  final String sceneName;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final palette = AppPalette.of(context);
    return SectionCard(
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xs),
        leading: Icon(Icons.schedule_rounded, color: automation.enabled ? palette.success : scheme.outline),
        title: Text(automation.name, style: theme.textTheme.titleMedium),
        subtitle: Text(
          'Mỗi ngày ${automation.trigger.time} · $sceneName',
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Switch(
              key: ValueKey('toggle-automation-${automation.id}'),
              value: automation.enabled,
              onChanged: onToggle,
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded),
              tooltip: 'Xoá tự động hoá',
              onPressed: onDelete,
            ),
          ],
        ),
      ),
    );
  }
}
