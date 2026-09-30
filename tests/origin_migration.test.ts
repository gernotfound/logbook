import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  currentUser: null as null | { uid: string },
  authStateReady: vi.fn(async () => {}),
}));

const migrationMocks = vi.hoisted(() => ({
  installTransferredLocalEnvelope: vi.fn(async () => ({ owner: 'user:a' })),
  readLocal: vi.fn(),
  findPendingAccountDeletion: vi.fn(() => null),
}));

vi.mock('../src/lib/firebase', () => ({ auth: authState }));

vi.mock('../src/lib/deploymentConfig', () => ({
  originMigrationSource: () => 'https://legacy.example',
  originMigrationTarget: () => window.location.origin,
}));

vi.mock('../src/lib/sync/localRepository', () => ({
  installTransferredLocalEnvelope: migrationMocks.installTransferredLocalEnvelope,
  readLocal: migrationMocks.readLocal,
}));

vi.mock('../src/lib/sync/accountGate', () => ({
  findPendingAccountDeletion: migrationMocks.findPendingAccountDeletion,
}));

import { installOriginMigrationPayload } from '../src/lib/originMigration';

const payload = (owner = 'user:a', device: Record<string, string> = {}) => ({
  version: 1 as const,
  sourceOrigin: 'https://legacy.example',
  owner,
  exportedAt: '2026-09-30T00:00:00.000Z',
  envelope: { owner },
  device,
});

describe('cross-origin migration install boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    authState.currentUser = null;
    authState.authStateReady.mockClear();
    migrationMocks.installTransferredLocalEnvelope.mockReset();
    migrationMocks.installTransferredLocalEnvelope.mockResolvedValue({ owner: 'user:a' });
  });

  it('rejects target-only owner-scoped device state instead of resurrecting stale data', async () => {
    localStorage.setItem('logbook:v2:user:a:workout', 'stale-target-workout');

    await expect(installOriginMigrationPayload(payload('user:a')))
      .rejects.toThrow('esistono già dati dispositivo diversi');

    expect(migrationMocks.installTransferredLocalEnvelope).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_origin_migration_decision_v1')).toBeNull();
  });

  it('allows an idempotent retry when existing device state and pending UID match exactly', async () => {
    localStorage.setItem('logbook:v2:user:a:workout', 'same-workout');
    localStorage.setItem('logbook_origin_migration_pending_uid_v1', 'a');

    await expect(installOriginMigrationPayload(payload('user:a', { workout: 'same-workout' })))
      .resolves.toEqual({ owner: 'user:a' });

    expect(migrationMocks.installTransferredLocalEnvelope).toHaveBeenCalledOnce();
    expect(localStorage.getItem('logbook_origin_migration_pending_uid_v1')).toBe('a');
    expect(localStorage.getItem('logbook_origin_migration_decision_v1')).toBe('completed');
  });

  it('rejects a transfer when a different migrated account is already pending locally', async () => {
    localStorage.setItem('logbook_origin_migration_pending_uid_v1', 'other-user');

    await expect(installOriginMigrationPayload(payload('user:a')))
      .rejects.toThrow('dati trasferiti per un altro account');

    expect(migrationMocks.installTransferredLocalEnvelope).not.toHaveBeenCalled();
  });

  it('rejects guest transfer while an account migration guard is pending', async () => {
    localStorage.setItem('logbook_origin_migration_pending_uid_v1', 'account-a');

    await expect(installOriginMigrationPayload(payload('guest')))
      .rejects.toThrow('dati trasferiti per un altro account');

    expect(migrationMocks.installTransferredLocalEnvelope).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_is_guest')).toBeNull();
  });
});
