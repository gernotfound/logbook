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

void test('single-branch wildcard repetition collapses safely, without nested regex quantifiers', () => {
  // Inspect compiled regex sources before executing them: a regression must not
  // accidentally run a catastrophic pattern against a long adversarial string.
  for (const pattern of ['+(*)', '+(*a)', '*(*a)', '+(a*)', '+(a*b)', '*(*.js)']) {
    assert.doesNotMatch(picomatch.makeRe(pattern).source, /\)[+*]/, pattern);
  }
  assert.equal(picomatch.isMatch('aaa', '+(*a)'), true);
  assert.equal(picomatch.isMatch('ab', '+(*a)'), false);
  assert.equal(picomatch.isMatch('foo.js', '*(*.js)'), true);
  assert.equal(picomatch.isMatch('foo.ts', '*(*.js)'), false);
});

void test('complex repeated extglobs are literalized instead of compiling unsafe regexes', () => {
  assert.equal(picomatch.makeRe('+(a|*a)').source, String.raw`^(?:\+\(a\|\*a\))import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const picomatch = require('picomatch');
const installed = require('picomatch/package.json');

void test('CI resolves the reviewed local picomatch backport', () => {
  assert.equal(installed.version, '4.0.8-logbook.0');
  assert.equal(typeof picomatch.makeRe, 'function');
});

);
  assert.equal(picomatch.makeRe('+(*(ab)c)').source, String.raw`^(?:\+\(\*\(ab\)c\))import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const picomatch = require('picomatch');
const installed = require('picomatch/package.json');

void test('CI resolves the reviewed local picomatch backport', () => {
  assert.equal(installed.version, '4.0.8-logbook.0');
  assert.equal(typeof picomatch.makeRe, 'function');
});

);
  assert.equal(picomatch.isMatch('aaa', '+(a|*a)'), false);
  assert.equal(picomatch.isMatch('abccc', '+(*(ab)c)'), false);
});

void test('ordinary glob patterns retain their documented matching behavior', () => {
  assert.equal(picomatch.isMatch('src/lib/file.ts', 'src/**/*.ts'), true);
  assert.equal(picomatch.isMatch('src/lib/file.js', 'src/**/*.ts'), false);
  assert.equal(picomatch.isMatch('abc', '+(*)'), true);
  assert.equal(picomatch.isMatch('aaa', '+(a*)'), true);
  assert.equal(picomatch.isMatch('other', 'other'), true);
  assert.equal(picomatch.isMatch('other', 'another'), false);
});
