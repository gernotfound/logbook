import assert from 'node:assert/strict';
import test from 'node:test';
import Workflow, { workflowSettings } from '../../kindeSrc/environment/workflows/thelogbookPassword/Workflow.js';

function event(password, reason) {
  return { context: { auth: { firstPassword: password, newPasswordReason: reason } } };
}

async function invoke(password, reason) {
  const previous = globalThis.kinde;
  const invalidations = [];
  globalThis.kinde = {
    widget: { invalidateFormField: (...args) => { invalidations.push(args); } },
  };
  try {
    await Workflow(event(password, reason));
    return invalidations;
  } finally {
    if (previous === undefined) delete globalThis.kinde;
    else globalThis.kinde = previous;
  }
}

void test('Kinde candidate declares a fail-closed password trigger and widget binding', () => {
  assert.equal(workflowSettings.trigger, 'user:new_password_provided');
  assert.deepEqual(workflowSettings.failurePolicy, { action: 'stop' });
  assert.deepEqual(workflowSettings.bindings, { 'kinde.widget': {} });
});

void test('signup and reset reject 8–14 code points and accept 15 or more', async () => {
  for (const reason of ['initial', 'reset']) {
    for (const length of [8, 10, 14]) {
      assert.deepEqual(await invoke('a'.repeat(length), reason), [
        ['p_first_password', 'La password deve contenere almeno 15 caratteri.'],
      ]);
    }
    for (const length of [15, 16, 64]) {
      assert.deepEqual(await invoke('a'.repeat(length), reason), []);
    }
  }
});

void test('Unicode code points cannot be inflated by UTF-16 surrogate pairs', async () => {
  assert.equal('🪴'.length, 2);
  assert.deepEqual(await invoke('a'.repeat(13) + '🪴', 'reset'), [
    ['p_first_password', 'La password deve contenere almeno 15 caratteri.'],
  ]);
  assert.deepEqual(await invoke('a'.repeat(14) + '🪴', 'initial'), []);
});

void test('unexpected provider event and missing widget do not pass silently', async () => {
  await assert.rejects(Workflow({ context: { auth: {} } }), /password-policy-input-unavailable/);
  const old = globalThis.kinde;
  delete globalThis.kinde;
  try {
    await assert.rejects(Workflow(event('a'.repeat(8), 'reset')));
  } finally {
    if (old !== undefined) globalThis.kinde = old;
  }
});
