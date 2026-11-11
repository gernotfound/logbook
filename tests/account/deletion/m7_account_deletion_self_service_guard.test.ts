import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// This is a boundary check, not a substitute for Firebase's provider policy.
function sourcesUnder(directory: string): string[] {
  const paths: string[] = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) paths.push(...sourcesUnder(path));
    else if (item.isFile() && /\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) {
      paths.push(path);
    }
  }
  return paths;
}

describe('Firebase account deletion provider boundary', () => {
  it('keeps the client free of direct Firebase account deletion SDK and REST calls', () => {
    for (const path of sourcesUnder(join(process.cwd(), 'src'))) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/\bdeleteUser\b|\bdeleteUsers\b|accounts:delete\b|accounts\/delete\b/);
    }
  });

  it('confines privileged Auth deletion to the trusted account deletion job', () => {
    const allowedPath = join(process.cwd(), 'server', 'accountDeletion', 'jobStore.ts');
    const trustedSources = [
      ...sourcesUnder(join(process.cwd(), 'server')),
      ...sourcesUnder(join(process.cwd(), 'api')),
    ];
    const callers = trustedSources
      .filter(path => /\.deleteUsers?\s*\(/.test(readFileSync(path, 'utf8')));
    expect(callers).toEqual([allowedPath]);
    expect(readFileSync(allowedPath, 'utf8')).toContain('await adminAuth().deleteUser(uid)');
  });
});
