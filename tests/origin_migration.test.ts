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

async function installOriginMigrationPayload(value: unknown) {
  const migration = await import('../src/lib/originMigration');
  return migration.installOriginMigrationPayload(value);
}

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
    // tests/setup.tsx imports AuthProvider (and therefore originMigration) before
    // this file's mocks are registered. Reset the module graph so the dynamic
    // import below observes the migration-specific deploymentConfig mock.
    vi.resetModules();
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

  it('fails closed when the pending account migration marker cannot be read', async () => {
    const originalGetItem = Storage.prototype.getItem;
    const readSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key: string) {
      if (key === 'logbook_origin_migration_pending_uid_v1') {
        throw new DOMException('storage blocked', 'SecurityError');
      }
      return originalGetItem.call(this, key);
    });

    try {
      const migration = await import('../src/lib/originMigration');
      expect(() => migration.originMigrationPendingUid()).toThrow('Browser storage read failed');
    } finally {
      readSpy.mockRestore();
    }
  });

  it('fences a partial cross-storage install, blocks skip, and completes through an idempotent retry', async () => {
    const migration = await import('../src/lib/originMigration');
    const originalSetItem = localStorage.setItem;
    let failedOnce = false;

    localStorage.setItem = vi.fn((key: string, value: string) => {
      if (!failedOnce && key === 'logbook:v2:user:a:workout') {
        failedOnce = true;
        throw new DOMException('quota full', 'QuotaExceededError');
      }
      originalSetItem.call(localStorage, key, value);
    });

    try {
      await expect(migration.installOriginMigrationPayload(payload('user:a', { workout: 'source-workout' })))
        .rejects.toThrow();
    } finally {
      localStorage.setItem = originalSetItem;
    }

    expect(migrationMocks.installTransferredLocalEnvelope).toHaveBeenCalledOnce();
    expect(localStorage.getItem('logbook_origin_migration_installing_owner_v1')).toBe('user:a');
    expect(localStorage.getItem('logbook_origin_migration_decision_v1')).toBeNull();
    expect(() => migration.skipOriginMigration()).toThrow('trasferimento precedente è incompleto');

    await expect(migration.installOriginMigrationPayload(payload('user:a', { workout: 'source-workout' })))
      .resolves.toEqual({ owner: 'user:a' });

    expect(migrationMocks.installTransferredLocalEnvelope).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('logbook:v2:user:a:workout')).toBe('source-workout');
    expect(localStorage.getItem('logbook_origin_migration_pending_uid_v1')).toBe('a');
    expect(localStorage.getItem('logbook_origin_migration_decision_v1')).toBe('completed');
    expect(localStorage.getItem('logbook_origin_migration_installing_owner_v1')).toBeNull();
  });
});
