import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareAssignments } from './check-test-discovery.mjs';

await test('accepts complete one-to-one discovery', () => {
  assert.deepEqual(compareAssignments(['a.test.ts', 'b.test.ts'], { general: ['a.test.ts'], isolated: ['b.test.ts'] }, 'Vitest'), []);
});

await test('rejects orphan files introduced outside runner discovery', () => {
  assert.match(compareAssignments(['a.test.ts', 'b.test.ts'], { general: ['a.test.ts'] }, 'Vitest').join('\n'), /undiscovered b\.test\.ts/);
});

await test('rejects overlapping discovery even when every expected file is present', () => {
  assert.match(compareAssignments(['a.test.ts'], { general: ['a.test.ts'], hardening: ['a.test.ts'] }, 'Vitest').join('\n'), /duplicate a\.test\.ts/);
});

await test('rejects tests selected from outside the tracked inventory', () => {
  assert.match(compareAssignments(['a.test.ts'], { general: ['a.test.ts', 'ghost.test.ts'] }, 'Vitest').join('\n'), /unexpected ghost\.test\.ts/);
});

await test('rejects an empty dedicated runner', () => {
  assert.match(compareAssignments(['a.test.ts'], { general: ['a.test.ts'], m7: [] }, 'Vitest').join('\n'), /empty runner m7/);
});

await test('rejects Playwright sharding loss and duplicate test identities', () => {
  const tests = ['e2e/a.spec.ts:3:1 › first', 'e2e/a.spec.ts:4:1 › second'];
  assert.match(compareAssignments(tests, { shard1: [tests[0]], shard2: [tests[0]] }, 'Playwright').join('\n'), /duplicate.*undiscovered/s);
});
