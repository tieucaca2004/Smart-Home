import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/theme/app_tokens.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/scene.dart';
import '../devices/widgets/section_card.dart';
import 'scene_icon.dart';
import 'widgets/device_action_picker.dart';

/// One action row's display text: the friendly text a fresh pick already
/// carries, or the raw `deviceId`/`functionCode` when the scene was loaded
/// for editing (the editor does not re-fetch every device just to relabel
/// actions it did not touch).
class _EditorAction {
  const _EditorAction({required this.action, required this.deviceLabel, required this.functionLabel});

  factory _EditorAction.fromSaved(SceneAction action) => _EditorAction(
        action: action,
        deviceLabel: action.deviceId,
        functionLabel: _prettifyCode(action.functionCode),
      );

  factory _EditorAction.fromPicked(PickedSceneAction picked) => _EditorAction(
        action: picked.action,
        deviceLabel: picked.deviceName,
        functionLabel: picked.functionLabel,
      );

  final SceneAction action;
  final String deviceLabel;
  final String functionLabel;
}

String _prettifyCode(String code) {
  final words = code.replaceAll('_', ' ').trim();
  if (words.isEmpty) return code;
  return '${words[0].toUpperCase()}${words.substring(1)}';
}

/// Create or edit a scene: its name, its icon, and its ordered list of
/// actions. Saving returns `true` via [Navigator.pop] so the caller knows to
/// reload; backing out without saving returns nothing.
///
/// [scene] null means "create"; non-null means "edit that scene" (its
/// actions are loaded from it, not re-fetched — the caller already has them).
class SceneEditorScreen extends StatefulWidget {
  const SceneEditorScreen({super.key, required this.client, this.scene});

  final HubApiClient client;
  final Scene? scene;

  @override
  State<SceneEditorScreen> createState() => _SceneEditorScreenState();
}

class _SceneEditorScreenState extends State<SceneEditorScreen> {
  late final TextEditingController _nameController;
  late SceneIcon _icon;
  late List<_EditorAction> _actions;
  bool _saving = false;
  String? _error;

  bool get _isEditing => widget.scene != null;

  @override
  void initState() {
    super.initState();
    final scene = widget.scene;
    _nameController = TextEditingController(text: scene?.name ?? '');
    _icon = SceneIcon.fromKey(scene?.icon ?? 'custom');
    _actions = [for (final a in scene?.actions ?? const <SceneAction>[]) _EditorAction.fromSaved(a)];
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _addAction() async {
    final picked = await pickDeviceAction(context, widget.client);
    if (picked != null) setState(() => _actions.add(_EditorAction.fromPicked(picked)));
  }

  void _removeAction(int index) => setState(() => _actions.removeAt(index));

  Future<void> _save() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Hãy đặt tên cho cảnh.');
      return;
    }
    if (_actions.isEmpty) {
      setState(() => _error = 'Hãy thêm ít nhất một hành động.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final scene = widget.scene;
      final actions = [for (final a in _actions) a.action];
      if (scene == null) {
        await widget.client.createScene(name: name, icon: _icon.key, actions: actions);
      } else {
        await widget.client.updateScene(scene.id, name: name, icon: _icon.key, actions: actions);
      }
      if (mounted) Navigator.of(context).pop(true);
    } on HubApiException catch (e) {
      final text = describeHubError(e, hubUrl: widget.client.baseUrl);
      setState(() {
        _saving = false;
        _error = '${text.title}. ${text.hint}';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEditing ? 'Sửa cảnh' : 'Cảnh mới'),
        actions: [
          IconButton(
            icon: _saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  )
                : const Icon(Icons.check_rounded),
            tooltip: 'Lưu',
            onPressed: _saving ? null : _save,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.screen),
        children: [
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(labelText: 'Tên cảnh', hintText: 'Ví dụ: Tắt toàn bộ quán'),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text('Biểu tượng', style: theme.textTheme.titleSmall),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final icon in SceneIcon.values)
                ChoiceChip(
                  key: ValueKey('icon-${icon.key}'),
                  label: Text(icon.label),
                  avatar: Icon(icon.icon, size: 18),
                  selected: _icon == icon,
                  onSelected: (_) => setState(() => _icon = icon),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.xl),
          Row(
            children: [
              Expanded(child: Text('Hành động', style: theme.textTheme.titleSmall)),
              TextButton.icon(
                onPressed: _addAction,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Thêm hành động'),
              ),
            ],
          ),
          if (_actions.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Text(
                'Chưa có hành động nào. Thêm ít nhất một thiết bị để lưu cảnh.',
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            )
          else
            for (var i = 0; i < _actions.length; i++) _ActionTile(entry: _actions[i], onRemove: () => _removeAction(i)),
          if (_error != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(_error!, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error)),
          ],
        ],
      ),
    );
  }
}

/// One action row in the editor: the device and function it was picked from,
/// and the value it will be set to, with a way to remove it.
class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.entry, required this.onRemove});

  final _EditorAction entry;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final action = entry.action;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: SectionCard(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
        child: Row(
          children: [
            Icon(
              action.value ? Icons.power_rounded : Icons.power_off_rounded,
              color: action.value ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(entry.deviceLabel, style: theme.textTheme.titleMedium),
                  Text(
                    '${entry.functionLabel} → ${action.value ? 'Bật' : 'Tắt'}',
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded),
              tooltip: 'Xoá hành động',
              onPressed: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}
