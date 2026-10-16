import { posix } from 'node:path';

// Check only destinations within this Git repository; external URLs require separate, live checks.
export function markdownTargets(markdown) {
  const targets = [];
  let fence = null;
  const lines = markdown.split(/\r?\n/);
  for (const [index, original] of lines.entries()) {
    const marker = original.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      const symbol = marker[1][0];
      if (!fence) fence = { symbol, size: marker[1].length };
      else if (fence.symbol === symbol && marker[1].length >= fence.size) fence = null;
      continue;
    }
    if (fence) continue;
    // Inline code spans are documentation, not navigable links.
    const line = original.replace(/(`+)[^`]*?\1/g, '');
    const add = target => targets.push({ target, line: index + 1 });
    const inline = /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)\n]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)]*\)))?\s*\)/g;
    for (const match of line.matchAll(inline)) add(match[1]);
    const reference = line.match(/^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/);
    if (reference) add(reference[1]);
    for (const match of line.matchAll(/\b(?:href|src)\s*=\s*(["'])([^"'\n]+)\1/g)) add(match[2]);
  }
  return targets;
}

export function checkMarkdownLinks(sources, { read, exists }) {
  const failures = [];
  for (const source of sources) {
    for (const { target, line } of markdownTargets(read(source))) {
      const unwrapped = target.startsWith('<') && target.endsWith('>')
        ? target.slice(1, -1)
        : target;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(unwrapped)) continue;
      const pathOnly = unwrapped.split(/[?#]/, 1)[0];
      if (!pathOnly) continue;
      let decoded;
      try { decoded = decodeURIComponent(pathOnly); }
      catch { failures.push(`${source}:${line}: malformed URL encoding: ${target}`); continue; }
      if (decoded.startsWith('/') || decoded.includes('\\')) {
        failures.push(`${source}:${line}: invalid repository-relative link: ${target}`);
        continue;
      }
      const destination = posix.normalize(posix.join(posix.dirname(source), decoded));
      if (destination === '..' || destination.startsWith('../') || !exists(destination)) {
        failures.push(`${source}:${line}: missing or out-of-repository target ${target} -> ${destination}`);
      }
    }
  }
  return failures;
}
