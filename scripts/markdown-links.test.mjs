import assert from 'node:assert/strict';
import test from 'node:test';
import { checkMarkdownLinks, markdownTargets } from './markdown-links.mjs';

function verify(sources, files) {
  return checkMarkdownLinks(sources, {
    read: name => files.get(name),
    exists: name => files.has(name),
  });
}

test('valid relative document, directory, image, and reference links resolve', () => {
  const files = new Map([
    ['docs/README.md', [
      '[archive](architecture/archive.md#safety)',
      '[folder](compliance/)',
      '![icon](../assets/icon.svg)',
      '[external](https://example.com/missing)',
      '[local reference]: <operations/guide%20book.md>',
    ].join('\n')],
    ['docs/architecture/archive.md', '# Safety'],
    ['docs/compliance/', ''],
    ['docs/operations/guide book.md', '# Guide'],
    ['assets/icon.svg', '<svg></svg>'],
  ]);
  assert.deepEqual(verify(['docs/README.md'], files), []);
});

test('broken links and traversal report source filename and line', () => {
  const files = new Map([['docs/README.md', '[missing](nope.md)\n[outside](../../private.md)']]);
  const failures = verify(['docs/README.md'], files);
  assert.equal(failures.length, 2);
  assert.match(failures[0], /docs\/README.md:1: missing/);
  assert.match(failures[1], /docs\/README.md:2: missing or out-of-repository/);
});

test('fenced and inline code containing links is not parsed', () => {
  const code = ['```md', '[example](missing.md)', '```', 'Use `[fake](missing.md)` inline.', '[real](real.md)'].join('\n');
  assert.deepEqual(markdownTargets(code), [{ target: 'real.md', line: 5 }]);
});

test('reference definition and HTML href are checked', () => {
  const file = '[ref]: missing.md\n<a href="also-missing.md">read</a>';
  const failures = verify(['docs/a.md'], new Map([['docs/a.md', file]]));
  assert.equal(failures.length, 2);
});

test('encoded URI errors fail closed; external URLs and same-document anchors are excluded', () => {
  const input = '[bad](%GG.md)\n[external](mailto:support@example.com)\n[anchor](#intro)';
  const failures = verify(['AGENTS.md'], new Map([['AGENTS.md', input]]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /malformed URL encoding/);
});
