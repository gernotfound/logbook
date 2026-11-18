import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const picomatch = require('picomatch');
const installed = require('picomatch/package.json');

void test('CI resolves the reviewed local picomatch backport', () => {
  assert.equal(installed.version, '4.0.8-logbook.0');
  assert.equal(typeof picomatch.makeRe, 'function');
});

void test('single-branch repeated extglobs are literalized before regex execution', () => {
  // Checking the compiled source avoids executing a potentially exponential
  // regex if a future dependency update accidentally removes the safeguard.
  assert.equal(picomatch.makeRe('+(*a)').source, String.raw`^(?:\+\(\*a\))$`);
  assert.equal(picomatch.makeRe('*(*a)').source, String.raw`^(?:\*\(\*a\))$`);
  assert.equal(picomatch.makeRe('+(a|*a)').source, String.raw`^(?:\+\(a\|\*a\))$`);
});

void test('ordinary glob patterns retain their documented matching behavior', () => {
  assert.equal(picomatch.isMatch('src/lib/file.ts', 'src/**/*.ts'), true);
  assert.equal(picomatch.isMatch('src/lib/file.js', 'src/**/*.ts'), false);
  assert.equal(picomatch.isMatch('abc', '+(*)'), true);
  assert.equal(picomatch.isMatch('aaa', '+(a*)'), true);
  assert.equal(picomatch.isMatch('other', 'other'), true);
  assert.equal(picomatch.isMatch('other', 'another'), false);
});
