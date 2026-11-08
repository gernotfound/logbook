import assert from 'node:assert/strict';
import test from 'node:test';
import { findDisabledTests } from './test-declaration-check.mjs';

for (const [source, reason] of [
  ["it.skip('x', () => {})", 'skip'],
  ["it.each([1]).skip('x', () => {})", 'skip'],
  ["test.concurrent.skip('x', () => {})", 'skip'],
  ["describe.each([1]).only('x', () => {})", 'only'],
  ["it.each([1]).todo('x')", 'todo'],
  ["fit('x', () => {})", 'only'],
  ["fdescribe('x', () => {})", 'only'],
  ["xit('x', () => {})", 'skip'],
  ["xtest('x', () => {})", 'skip'],
  ["xdescribe('x', () => {})", 'skip'],
  ["test['concurrent']['skip']('x', () => {})", 'skip'],
  ["test.concurrent\n  .skip('x', () => {})", 'skip'],
  ["test.skipIf(true)('x', () => {})", 'skipIf'],
  ["describe.runIf(false)('x', () => {})", 'runIf'],
  ["test.each([1]).skipIf(true)('x', () => {})", 'skipIf'],
  ["import { it as scenario } from 'vitest'; scenario.skip('x', () => {})", 'skip'],
  ["import { test as check } from '@jest/globals'; check.only('x', () => {})", 'only'],
  ["import { describe as group } from 'vitest'; group.runIf(false)('x', () => {})", 'runIf'],
  ["import { fit as focused } from 'vitest'; focused('x', () => {})", 'only'],
  ["import testCase from 'node:test'; testCase.skip('x', () => {})", 'skip'],
  ["import * as suite from 'vitest'; suite.test.skipIf(true)('x', () => {})", 'skipIf'],
  ["import * as checks from '@jest/globals'; checks.describe.only('x', () => {})", 'only'],
]) {
  await test('detects disabled declaration: ' + source, () => {
    const findings = findDisabledTests(source);
    assert.ok(findings.some(f => f.label === reason), JSON.stringify(findings));
  });
}

for (const source of [
  "it('x', () => {})",
  "it.each([1])('x', () => {})",
  "// it.skip('x', () => {})",
  "const text = \"test.only('x')\";",
  "obj.skip('x', () => {})",
  "import { test as check } from './helpers'; check.skip('x', () => {})",
  "import * as helper from './helpers'; helper.it.skip('x', () => {})",
  "import type { test as scenario } from 'vitest'; scenario.skip('x', () => {})",
  "describe('suite', () => { it('works', () => {}) })",
]) {
  await test('allows ordinary source: ' + source, () => {
    assert.deepEqual(findDisabledTests(source), []);
  });
}

await test('keeps source locations when parsing TS satisfies and JSX syntax', () => {
  const source = [
    "import { test as check } from 'vitest';",
    'const view = <div data-value={1} />;',
    'const result = (1 satisfies number);',
    "check.skip('disabled', () => {});",
  ].join('\n');
  assert.deepEqual(findDisabledTests(source, 'fixture.test.tsx').map(({ line, label, expression }) => ({
    line, label, expression,
  })), [{ line: 4, label: 'skip', expression: 'check.skip' }]);
});
