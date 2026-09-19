import 'package:flutter/foundation.dart';

import '../data/hub_api_exception.dart';

/// Where an asynchronous load currently stands.
sealed class LoadState<T> {
  const LoadState();
}

final class LoadInProgress<T> extends LoadState<T> {
  const LoadInProgress();
}

final class LoadSuccess<T> extends LoadState<T> {
  const LoadSuccess(this.data);

  final T data;
}

final class LoadFailure<T> extends LoadState<T> {
  const LoadFailure(this.error);

  final HubApiException error;
}

/// Runs one async loader and exposes its progress as a [LoadState].
///
/// Deliberately tiny: no state-management package, just a [ChangeNotifier]
/// that widgets listen to with `ListenableBuilder`. Calling [load] again
/// (retry / refresh) supersedes any load still in flight, and a result that
/// arrives after [dispose] is dropped.
class LoadController<T> extends ChangeNotifier {
  LoadController(this._loader);

  final Future<T> Function() _loader;

  LoadState<T> _state = LoadInProgress<T>();
  int _generation = 0;
  bool _disposed = false;

  LoadState<T> get state => _state;

  /// Starts (or restarts) the load and shows the in-progress state meanwhile.
  Future<void> load() => _run(showProgress: true);

  /// Reloads without flipping to the in-progress state, so a pull-to-refresh
  /// keeps the current content on screen until the new result is ready.
  Future<void> refresh() => _run(showProgress: false);

  Future<void> _run({required bool showProgress}) async {
    final generation = ++_generation;
    if (showProgress) _emit(LoadInProgress<T>());

    final result = await _attempt();

    if (_disposed || generation != _generation) return;
    _emit(result);
  }

  Future<LoadState<T>> _attempt() async {
    try {
      return LoadSuccess<T>(await _loader());
    } on HubApiException catch (e) {
      return LoadFailure<T>(e);
    } catch (e) {
      return LoadFailure<T>(HubApiException(HubApiErrorKind.unexpected, e.toString()));
    }
  }

  void _emit(LoadState<T> next) {
    if (_disposed) return;
    _state = next;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
