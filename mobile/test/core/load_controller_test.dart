import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tieu_home/core/load_controller.dart';
import 'package:tieu_home/data/hub_api_exception.dart';

/// Records the *type* of every state the controller announces.
List<String> record(LoadController<int> controller) {
  final seen = <String>[];
  controller.addListener(() {
    seen.add(switch (controller.state) {
      LoadInProgress() => 'progress',
      LoadSuccess(:final data) => 'success:$data',
      LoadFailure(:final error) => 'failure:${error.kind.name}',
    });
  });
  return seen;
}

void main() {
  test('starts in progress before anything is loaded', () {
    final controller = LoadController<int>(() async => 1);

    expect(controller.state, isA<LoadInProgress<int>>());
    controller.dispose();
  });

  test('load announces progress, then the data', () async {
    final controller = LoadController<int>(() async => 7);
    final seen = record(controller);

    await controller.load();

    expect(seen, ['progress', 'success:7']);
    controller.dispose();
  });

  test('a HubApiException becomes a failure carrying that exception', () async {
    const error = HubApiException(HubApiErrorKind.network, 'down');
    final controller = LoadController<int>(() async => throw error);
    final seen = record(controller);

    await controller.load();

    expect(seen, ['progress', 'failure:network']);
    expect(controller.state, isA<LoadFailure<int>>().having((s) => s.error, 'error', same(error)));
    controller.dispose();
  });

  test('any other exception becomes an "unexpected" failure', () async {
    final controller = LoadController<int>(() async => throw StateError('bug'));
    final seen = record(controller);

    await controller.load();

    expect(seen, ['progress', 'failure:unexpected']);
    controller.dispose();
  });

  test('retrying after a failure can succeed', () async {
    var calls = 0;
    final controller = LoadController<int>(() async {
      calls++;
      if (calls == 1) throw const HubApiException(HubApiErrorKind.timeout, 'slow');
      return 42;
    });
    final seen = record(controller);

    await controller.load();
    await controller.load();

    expect(seen, ['progress', 'failure:timeout', 'progress', 'success:42']);
    controller.dispose();
  });

  test('refresh keeps the current state until the new result arrives', () async {
    var value = 1;
    final controller = LoadController<int>(() async => value);
    await controller.load();
    final seen = record(controller);

    value = 2;
    await controller.refresh();

    expect(seen, ['success:2']);
    controller.dispose();
  });

  test('a newer load supersedes one still in flight', () async {
    final first = Completer<int>();
    final second = Completer<int>();
    final pending = [first, second];
    var calls = 0;
    final controller = LoadController<int>(() => pending[calls++].future);

    final firstLoad = controller.load();
    final secondLoad = controller.load();
    second.complete(2);
    await secondLoad;
    first.complete(1);
    await firstLoad;

    expect(controller.state, isA<LoadSuccess<int>>().having((s) => s.data, 'data', 2));
    controller.dispose();
  });

  test('a result arriving after dispose is dropped without error', () async {
    final completer = Completer<int>();
    final controller = LoadController<int>(() => completer.future);
    final seen = record(controller);

    final load = controller.load();
    controller.dispose();
    completer.complete(5);
    await load;

    expect(seen, ['progress']);
  });
}
