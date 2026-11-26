import { describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

const transport = vi.hoisted(() => ({
  entered: null as null | (() => void),
  wait: null as null | Promise<void>,
  calls: 0,
}));
vi.mock('../../../src/lib/healthConsentFirebaseTransport', async () => {
  transport.entered?.();
  if (transport.wait) await transport.wait;
  return {
    requestFirebaseHealthConsent: async () => {
      transport.calls += 1;
      return { status: 'withdrawn', revision: 2 };
    },
  };
});

import { readHealthConsentServerStatus } from '../../../src/lib/healthConsent';
import { installLegacyHealthConsentIdentity } from '../../../src/lib/healthConsentLegacyIdentity';
import { invalidateSession } from '../../../src/lib/sync/session';

describe('Legacy transport lazy-load session fence', () => {
  it('does not send a stale request after account A→B→A during module loading', async () => {
    const actor = { uid: 'legacy-account' } as User;
    const other = { uid: 'another-account' } as User;
    let current: User | null = actor;
    const dispose = installLegacyHealthConsentIdentity(() => current);
    let entered!: () => void;
    let release!: () => void;
    const loading = new Promise<void>(resolve => { entered = resolve; });
    transport.entered = entered;
    transport.wait = new Promise<void>(resolve => { release = resolve; });
    try {
      const pending = readHealthConsentServerStatus(actor);
      await loading;
      current = other;
      invalidateSession();
      current = actor;
      invalidateSession();
      release();
      await expect(pending).rejects.toThrow('Sessione cambiata');
      expect(transport.calls).toBe(0);
    } finally {
      release();
      dispose();
    }
  });
});
