import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDialogController, dialogController } from '../src/utils/dialogs.js';
import { printDocument } from '../src/utils/print.js';

test('confirm waits for a decision and cancellation prevents the guarded action', async () => {
  const controller = createDialogController();
  let actions = 0;
  const action = async () => { if (!(await controller.open('confirm', 'Deactivate account?'))) return; actions++; };
  const cancelled = action();
  assert.equal(actions, 0);
  controller.settle(controller.getSnapshot().id, false);
  await cancelled;
  assert.equal(actions, 0);
  const confirmed = action();
  controller.settle(controller.getSnapshot().id, true);
  await confirmed;
  assert.equal(actions, 1);
});

test('optional prompt preserves the distinction between empty notes and cancellation', async () => {
  const controller = createDialogController();
  const blank = controller.open('prompt', 'Optional notes');
  controller.settle(controller.getSnapshot().id, '');
  assert.equal(await blank, '');
  const cancelled = controller.open('prompt', 'Optional notes');
  controller.settle(controller.getSnapshot().id, null);
  assert.equal(await cancelled, null);
});

test('prompt preserves entered notes and enforces required reason and length bounds', async () => {
  const controller = createDialogController();
  const result = controller.open('prompt', 'Reason required', 'Initial text', { required: true, maxLength: 20 });
  const active = controller.getSnapshot();
  assert.equal(active.defaultValue, 'Initial text');
  assert.equal(controller.settle(active.id, ''), false);
  assert.equal(controller.settle(active.id, '   '), false);
  assert.equal(controller.settle(active.id, 'x'.repeat(21)), false);
  assert.equal(controller.getSnapshot(), active);
  controller.settle(active.id, 'Inspection verified');
  assert.equal(await result, 'Inspection verified');
});

test('queued dialogs preserve order and stale dismissals cannot accept the next action', async () => {
  const controller = createDialogController();
  const first = controller.open('alert', 'First message');
  const firstId = controller.getSnapshot().id;
  const second = controller.open('confirm', 'Second message');
  assert.equal(controller.getSnapshot().message, 'First message');
  controller.settle(firstId, true);
  assert.equal(await first, undefined);
  assert.equal(controller.getSnapshot().message, 'Second message');
  assert.equal(controller.settle(firstId, true), false);
  controller.settle(controller.getSnapshot().id, false);
  assert.equal(await second, false);
  assert.equal(controller.getSnapshot(), null);
});

test('subscribers can detach and snapshots remain stable between actual changes', async () => {
  const controller = createDialogController();
  let changes = 0;
  const unsubscribe = controller.subscribe(() => changes++);
  const pending = controller.open('alert', 'Notice');
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot, controller.getSnapshot());
  assert.equal(changes, 1);
  unsubscribe();
  controller.settle(snapshot.id, undefined);
  await pending;
  assert.equal(changes, 1);
});

test('a required reason can still be cancelled without submitting any text', async () => {
  const controller = createDialogController();
  const result = controller.open('prompt', 'Reason', '', { required: true });
  controller.settle(controller.getSnapshot().id, null);
  assert.equal(await result, null);
});

test('blocked printing shows the themed notice without calling a browser alert', () => {
  const previous = globalThis.window;
  globalThis.window = { open: () => null, alert: () => assert.fail('native alerts must not run') };
  try {
    printDocument('<html><head></head><body>Report</body></html>');
    assert.equal(dialogController.getSnapshot().type, 'alert');
    assert.match(dialogController.getSnapshot().message, /Allow pop-ups/);
    dialogController.settle(dialogController.getSnapshot().id, undefined);
  } finally { globalThis.window = previous; }
});
