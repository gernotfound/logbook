import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Vercel backend-only build', () => {
  it('publishes only the non-cacheable retirement service worker as static output', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'logbook-vercel-static-'));
    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/build-vercel-backend.mjs', outputDirectory],
        { cwd: process.cwd(), encoding: 'utf8' },
      );

      expect(result.status).toBe(0);
      expect(readdirSync(outputDirectory)).toEqual(['sw.js']);

      const worker = readFileSync(join(outputDirectory, 'sw.js'), 'utf8');
      expect(worker).toContain('self.skipWaiting()');
      expect(worker).toContain('self.clients.claim()');
      expect(worker).toContain('caches.keys()');
      expect(worker).toContain('self.registration.unregister()');
      expect(worker).toContain("client.navigate('/')");
      expect(worker).not.toContain('precache');
      expect(worker).not.toContain('__WB_MANIFEST');
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
