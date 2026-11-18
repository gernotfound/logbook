import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { selectPublishedFix, isOfficialPublishedFix, issueAlreadyExists } from '../../scripts/check-picomatch-upstream.mjs';

const require = createRequire(import.meta.url);
const picomatch = require('picomatch');
const installed = require('picomatch/package.json');
const { removeBackslashes } = require('../../vendor/picomatch/lib/utils.js');

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
  assert.equal(picomatch.makeRe('+(a|*a)').source, String.raw`^(?:\+\(a\|\*a\))$`);
  assert.equal(picomatch.makeRe('+(*(ab)c)').source, String.raw`^(?:\+\(\*\(ab\)c\))$`);
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


void test('linear backslash removal retains bracket class and escape semantics', () => {
  const cases = [
    ['plain', 'plain'],
    ['a\\b', 'ab'],
    ['a\\\\b', 'ab'],
    ['abc\\', 'abc\\'],
    ['[abc]', '[abc]'],
    ['[a\\b]', '[a\\b]'],
    ['[a\\]b]', '[a\\]b]'],
    ['[a\\]', '[a]'],
    ['[[]', '[[]'],
    ['[[a]]', '[[a]]'],
    ['[a\n]', '[a\n]'],
    ['[a\nb]\\x', '[a\nb]x'],
    ['\\\n', '\\\n'],
    ['[a\\]b]x\\y', '[a\\]b]xy'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(removeBackslashes(input), expected, JSON.stringify(input));
  }
});

void test('unmatched brackets and backslashes have linear-sized output', () => {
  const openBrackets = '['.repeat(50_000);
  assert.equal(removeBackslashes(openBrackets), openBrackets);
  assert.equal(removeBackslashes(openBrackets + '\\a'), openBrackets + 'a');
  assert.equal(removeBackslashes(openBrackets + ']'), openBrackets + ']');
});


void test('monitor fails closed for withdrawn, missing and inconsistent security advisories', () => {
  const sample = { ghsa_id: 'GHSA-fc5q-39xc-vjpf', vulnerabilities: [{
    package: { ecosystem: 'npm', name: 'picomatch' }, first_patched_version: null,
  }] };
  assert.equal(selectPublishedFix(sample), null);
  assert.equal(selectPublishedFix({ ...sample, withdrawn_at: '2026-11-18T00:00:00Z' }), null);
  assert.equal(selectPublishedFix({ ...sample, ghsa_id: 'GHSA-wrong' }), null);
  assert.equal(selectPublishedFix({ ...sample, vulnerabilities: [{
    package: { ecosystem: 'npm', name: 'other' },
    first_patched_version: { identifier: '4.0.8' },
  }] }), null);
  assert.throws(() => selectPublishedFix({ ghsa_id: sample.ghsa_id }), /Incomplete/);
});

void test('monitor requires official stable patched version published with valid npm metadata', () => {
  const vuln = { package: { ecosystem: 'npm', name: 'picomatch' },
    first_patched_version: { identifier: '4.0.8' } };
  const advisory = { ghsa_id: 'GHSA-fc5q-39xc-vjpf', vulnerabilities: [vuln] };
  assert.equal(selectPublishedFix(advisory), '4.0.8');
  assert.equal(selectPublishedFix({ ...advisory, vulnerabilities: [{
    ...vuln, first_patched_version: { identifier: '4.0.8-rc.1' },
  }] }), null);
  assert.equal(selectPublishedFix({ ...advisory, vulnerabilities: [{
    ...vuln, first_patched_version: { identifier: '4.0.7' },
  }] }), null);
  const release = { name: 'picomatch', version: '4.0.8', dist: {
    integrity: 'sha512-aGVsbG8=', tarball: 'https://registry.npmjs.org/picomatch/-/picomatch-4.0.8.tgz',
  } };
  assert.equal(isOfficialPublishedFix(release, '4.0.8'), true);
  assert.equal(isOfficialPublishedFix({ ...release, version: '4.0.7' }, '4.0.8'), false);
  assert.equal(isOfficialPublishedFix({ ...release, dist: {
    ...release.dist, tarball: 'https://example.com/not-official.tgz',
  } }, '4.0.8'), false);
});

void test('monitor does not create another issue when an open or closed match exists', () => {
  const title = '[Security] picomatch: replace local GHSA-fc5q-39xc-vjpf backport';
  assert.equal(issueAlreadyExists([{ title, state: 'closed' }]), true);
  assert.equal(issueAlreadyExists([{ title, state: 'open', pull_request: {} }]), false);
  assert.equal(issueAlreadyExists([{ title: 'unrelated', state: 'open' }]), false);
});
