import 'package:flutter/material.dart';

import '../../core/hub_error_message.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/widgets/state_views.dart';
import '../../data/hub_api_client.dart';
import '../../data/hub_api_exception.dart';
import '../../models/automation.dart';
import '../../models/scene.dart';
import 'scene_icon.dart';

/// Create or edit an automation: its name, whether it is on, the daily time
/// it fires, and which scene it runs. Saving returns `true` via
/// [Navigator.pop]; backing out without saving returns nothing.
class AutomationEditorScreen extends StatefulWidget {
  const AutomationEditorScreen({super.key, required this.client, this.automation});

  final HubApiClient client;
  final Automation? automation;

  @override
  State<AutomationEditorScreen> createState() => _AutomationEditorScreenState();
}

class _AutomationEditorScreenState extends State<AutomationEditorScreen> {
  late final TextEditingController _nameController;
  late bool _enabled;
  late TimeOfDay _time;
  String? _sceneId;
  bool _saving = false;
  String? _error;

  late Future<List<Scene>> _scenesFuture;

  bool get _isEditing => widget.automation != null;

  @override
  void initState() {
    super.initState();
    final automation = widget.automation;
    _nameController = TextEditingController(text: automation?.name ?? '');
    _enabled = automation?.enabled ?? true;
    _time = automation == null ? const TimeOfDay(hour: 18, minute: 0) : _parseTime(automation.trigger.time);
    _sceneId = automation?.sceneId;
    _scenesFuture = widget.client.fetchScenes();
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  static TimeOfDay _parseTime(String hhmm) {
    final parts = hhmm.split(':');
    return TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1]));
  }

  String get _timeText =>
      '${_time.hour.toString().padLeft(2, '0')}:${_time.minute.toString().padLeft(2, '0')}';

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: _time);
    if (picked != null) setState(() => _time = picked);
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    final sceneId = _sceneId;
    if (name.isEmpty) {
      setState(() => _error = 'Hãy đặt tên cho tự động hoá.');
      return;
    }
    if (sceneId == null) {
      setState(() => _error = 'Hãy chọn một cảnh để chạy.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final trigger = AutomationTrigger(type: 'daily', time: _timeText);
    try {
      final automation = widget.automation;
      if (automation == null) {
        await widget.client.createAutomation(name: name, enabled: _enabled, trigger: trigger, sceneId: sceneId);
      } else {
        await widget.client.updateAutomation(
          automation.id,
          name: name,
          enabled: _enabled,
          trigger: trigger,
          sceneId: sceneId,
        );
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
        title: Text(_isEditing ? 'Sửa tự động hoá' : 'Tự động hoá mới'),
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
            decoration: const InputDecoration(labelText: 'Tên', hintText: 'Ví dụ: Mở quán lúc 18:00'),
          ),
          const SizedBox(height: AppSpacing.lg),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Bật tự động hoá'),
            value: _enabled,
            onChanged: (v) => setState(() => _enabled = v),
          ),
          const SizedBox(height: AppSpacing.md),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.schedule_rounded),
            title: const Text('Chạy lúc'),
            subtitle: Text('Mỗi ngày, $_timeText'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: _pickTime,
          ),
          const SizedBox(height: AppSpacing.lg),
          Text('Cảnh sẽ chạy', style: theme.textTheme.titleSmall),
          const SizedBox(height: AppSpacing.sm),
          FutureBuilder<List<Scene>>(
            future: _scenesFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LoadingView(compact: true, message: 'Đang tải danh sách cảnh…');
              }
              if (snapshot.hasError) {
                return ErrorView(
                  compact: true,
                  title: 'Không tải được danh sách cảnh',
                  hint: 'Hãy thử lại.',
                  detail: snapshot.error.toString(),
                  onRetry: () => setState(() => _scenesFuture = widget.client.fetchScenes()),
                );
              }
              final scenes = snapshot.data!;
              if (scenes.isEmpty) {
                return Text(
                  'Chưa có cảnh nào. Hãy tạo một cảnh trước khi tạo tự động hoá.',
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                );
              }
              return RadioGroup<String>(
                groupValue: _sceneId,
                onChanged: (v) => setState(() => _sceneId = v),
                child: Column(
                  children: [
                    for (final scene in scenes)
                      RadioListTile<String>(
                        key: ValueKey('pick-scene-${scene.id}'),
                        contentPadding: EdgeInsets.zero,
                        value: scene.id,
                        secondary: Icon(SceneIcon.fromKey(scene.icon).icon),
                        title: Text(scene.name),
                      ),
                  ],
                ),
              );
            },
          ),
          if (_error != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(_error!, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error)),
          ],
        ],
      ),
    );
  }
}
