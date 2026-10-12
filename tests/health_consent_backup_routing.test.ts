import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  localStatus: 'reaccepting' as string,
  serverStatus: 'withdrawn' as string,
  serverRead: vi.fn(async () => 'withdrawn' as string),
  trustedExport: vi.fn(async () => new Map([['', {
    _schemaVersion: 1,
    _sync: {
      protocolVersion: 3, clock: {}, fields: {},
      writer: { slot: 's00', replicaId: 'consent-backup-device', generation: 1, seq: 0, consentRevision: 2 },
    },
    profile: { height: '178' },
  }]])),
  directRootRead: vi.fn(async () => ({
    exists: () => true,
    data: () => ({
    _schemaVersion: 1,
    _sync: {
      protocolVersion: 3, clock: {}, fields: {},
      writer: { slot: 's00', replicaId: 'consent-backup-device', generation: 1, seq: 0, consentRevision: 2 },
    },
    profile: { height: '178' },
  }),
  })),
}));

vi.mock('../src/lib/healthConsent', () => ({
  currentHealthConsentStatus: () => boundary.localStatus,
  readHealthConsentServerStatus: boundary.serverRead,
}));
vi.mock('../src/lib/firebase', () => ({
  auth: { currentUser: { uid: 'consent-export-user' } },
  getDb: () => ({}),
  ensureAppCheck: vi.fn(async () => {}),
}));
vi.mock('../src/lib/sync/session', () => ({
  captureSession: () => ({ owner: 'user:consent-export-user', epoch: 1 }),
  isCurrentSession: () => true,
}));
vi.mock('../src/lib/sync/localRepository', () => ({
  readLocal: vi.fn(async () => undefined),
}));
vi.mock('../src/lib/catalog/catalogService', () => ({
  getCachedCatalog: vi.fn(async () => ({ exercises: [], foods: [] })),
}));
vi.mock('../src/lib/db/withdrawnBackupTransport', () => ({
  fetchWithdrawnCloudBackup: boundary.trustedExport,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDocFromServer: boundary.directRootRead,
  getDocsFromServer: vi.fn(async () => ({ docs: [], size: 0 })),
  documentId: () => '__name__',
  orderBy: () => ({}),
  limit: () => ({}),
  query: (ref: unknown) => ref,
  startAfter: () => ({}),
}));

import { collectBackupSnapshot } from '../src/lib/db/backupSnapshot';
import { UserDataSchema } from '../src/lib/schema';

beforeEach(() => {
  vi.clearAllMocks();
  boundary.localStatus = 'reaccepting';
  boundary.serverStatus = 'withdrawn';
  boundary.serverRead.mockImplementation(async () => boundary.serverStatus);
  boundary.trustedExport.mockResolvedValue(new Map([['', {
    _schemaVersion: 1,
    _sync: {
      protocolVersion: 3, clock: {}, fields: {},
      writer: { slot: 's00', replicaId: 'consent-backup-device', generation: 1, seq: 0, consentRevision: 2 },
    },
    profile: { height: '178' },
  }]]));
});

const exportSnapshot = () => collectBackupSnapshot(UserDataSchema.parse({}), true);

describe('health consent rights export transport routing', () => {
  it('uses trusted authenticated export while reacceptance is still withdrawn remotely', async () => {
    const snapshot = await exportSnapshot();
    expect(snapshot.coverage.scope).toBe('cloud-and-device');
    expect(boundary.serverRead).toHaveBeenCalledTimes(1);
    expect(boundary.trustedExport).toHaveBeenCalledTimes(1);
    expect(boundary.directRootRead).not.toHaveBeenCalled();
  });

  it('uses ordinary Firestore reads once a reacceptance is already active remotely', async () => {
    boundary.serverStatus = 'active';
    const snapshot = await exportSnapshot();
    expect(snapshot.coverage.scope).toBe('cloud-and-device');
    expect(boundary.serverRead).toHaveBeenCalledTimes(1);
    expect(boundary.trustedExport).not.toHaveBeenCalled();
    expect(boundary.directRootRead).toHaveBeenCalledTimes(1);
  });

  it('honours a server withdrawal even when a local stale-request was set while active', async () => {
    boundary.localStatus = 'stale-request';
    const snapshot = await exportSnapshot();
    expect(snapshot.coverage.scope).toBe('cloud-and-device');
    expect(boundary.trustedExport).toHaveBeenCalledTimes(1);
    expect(boundary.directRootRead).not.toHaveBeenCalled();
  });

  it('keeps verified active sessions on the ordinary least-privileged read path', async () => {
    boundary.localStatus = 'active';
    await exportSnapshot();
    expect(boundary.serverRead).not.toHaveBeenCalled();
    expect(boundary.trustedExport).not.toHaveBeenCalled();
    expect(boundary.directRootRead).toHaveBeenCalledTimes(1);
  });
});
