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
  "describe('suite', () => { it('works', () => {}) })",
]) {
  await test('allows ordinary source: ' + source, () => {
    assert.deepEqual(findDisabledTests(source), []);
  });
}
