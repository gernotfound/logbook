import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  localStatus: 'reaccepting' as string,
  offlineReaccept: false,
  serverStatus: 'withdrawn' as string,
  serverRead: vi.fn(async () => 'withdrawn' as string),
  trustedExport: vi.fn(async (): Promise<Map<string, unknown>> => new Map([['', {
    _schemaVersion: 1,
    _sync: {
      protocolVersion: 3, clock: {}, fields: {},
      writer: { slot: 's00', replicaId: 'consent-backup-device', generation: 1, seq: 0, consentRevision: 2 },
    },
    profile: { height: '178' },
  }]])),
  // Replica-control reads bracket every direct full-cloud backup scan.
  controlRead: vi.fn(async () => ({
    exists: () => true,
    data: () => ({ protocolVersion: 3, replicas: { s00: { lastSeq: 1 } } }),
  })),
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
  hasUnreconciledOfflineReaccept: () => boundary.offlineReaccept,
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
vi.mock('../src/lib/sync/cloudAccountKeyAccess', () => ({
  requireRightsExportAccountDataKey: vi.fn(async () => new Uint8Array(32).fill(17)),
  requireCloudAccountDataKey: vi.fn(async () => new Uint8Array(32).fill(17)),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDocFromServer: (ref: { path: string }) => ref.path.endsWith('/sync_control/state')
    ? boundary.controlRead() : boundary.directRootRead(),
  getDocsFromServer: vi.fn(async () => ({ docs: [], size: 0 })),
  documentId: () => '__name__',
  orderBy: () => ({}),
  limit: () => ({}),
  query: (ref: unknown) => ref,
  startAfter: () => ({}),
}));

import { collectBackupSnapshot } from '../src/lib/db/backupSnapshot';
import { UserDataSchema } from '../src/lib/schema';
import { sealCloudDocument } from '../src/lib/sync/cloudDocumentCipher';

beforeEach(() => {
  vi.clearAllMocks();
  boundary.localStatus = 'reaccepting';
  boundary.offlineReaccept = false;
  boundary.serverStatus = 'withdrawn';
  boundary.serverRead.mockImplementation(async () => boundary.serverStatus);
  boundary.directRootRead.mockImplementation(async () => ({
    exists: () => true,
    data: () => sealCloudDocument(new Uint8Array(32).fill(17), 'consent-export-user', '',
      { profile: { height: '178' } }, {
        protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's00', replicaId: 'consent-backup-device', generation: 1, seq: 0, consentRevision: 2 },
      }),
  }));
  boundary.trustedExport.mockResolvedValue(new Map([['', sealCloudDocument(
    new Uint8Array(32).fill(17), 'consent-export-user', '',
    { profile: { height: '178' } },
    {
      protocolVersion: 3, clock: {}, fields: {},
      writer: { slot: 's00', replicaId: 'consent-backup-device', generation: 1, seq: 0, consentRevision: 2 },
    },
  )]]));
});

const exportSnapshot = () => collectBackupSnapshot(UserDataSchema.parse({}), true);

describe('health consent rights export transport routing', () => {
  it('routes withdrawn server consent through the privileged export adapter without direct Firestore reads', async () => {
    const snapshot = await exportSnapshot();
    expect(snapshot.coverage.scope).toBe('cloud-and-device');
    expect(boundary.serverRead).toHaveBeenCalledTimes(1);
    expect(boundary.trustedExport).toHaveBeenCalledTimes(1);
    expect(snapshot.data.profile?.height).toBe('178');
    expect((snapshot.recovery.cloudDocuments as Record<string, any>)[''].profile.height).toBe('178');
    expect((snapshot.recovery.cloudDocuments as Record<string, any>)['']._sealed).toBeUndefined();
    expect(boundary.directRootRead).not.toHaveBeenCalled();
    expect(boundary.controlRead).not.toHaveBeenCalled();
  });

  it('decrypts every encrypted month after the signed rights-export scan and rejects tampering', async () => {
    const key = new Uint8Array(32).fill(17);
    const sync = {
      protocolVersion: 3 as const, clock: {}, fields: {},
      writer: { slot: 's00', replicaId: 'consent-backup-device', generation: 1, seq: 0, consentRevision: 2 },
    };
    const goodMonth = sealCloudDocument(key, 'consent-export-user', 'nutrition_months/2026-10',
      { '2026-10-24': { date: '2026-10-24', weight: 80 } }, sync);
    const originalRoot = sealCloudDocument(key, 'consent-export-user', '',
      { profile: { height: '178' } }, sync);
    boundary.trustedExport.mockResolvedValue(new Map([
      ['', originalRoot], ['nutrition_months/2026-10', goodMonth],
    ]));
    const snapshot = await exportSnapshot();
    expect(snapshot.coverage.scope).toBe('cloud-and-device');
    expect(snapshot.coverage.months).toEqual(['2026-10']);
    expect(snapshot.data.nutrition?.['2026-10-24']?.weight).toBe(80);
    expect((snapshot.recovery.cloudDocuments as Record<string, any>)['nutrition_months/2026-10']._sealed)
      .toBeUndefined();

    boundary.trustedExport.mockResolvedValue(new Map([
      ['', originalRoot], ['nutrition_months/2026-10', {
        ...goodMonth, _sealed: { ...goodMonth._sealed, ciphertext: 'CORRUPTED' },
      }],
    ]));
    await expect(exportSnapshot()).rejects.toThrow('Documento cloud cifrato non valido');
    expect(boundary.directRootRead).not.toHaveBeenCalled();
  });

  it('uses ordinary Firestore reads once a reacceptance is already active remotely', async () => {
    boundary.serverStatus = 'active';
    const snapshot = await exportSnapshot();
    expect(snapshot.coverage.scope).toBe('cloud-and-device');
    expect(boundary.serverRead).toHaveBeenCalledTimes(1);
    expect(boundary.trustedExport).not.toHaveBeenCalled();
    expect(boundary.directRootRead).toHaveBeenCalledTimes(1);
    expect(boundary.controlRead).toHaveBeenCalledTimes(2);
  });

  it('honours a server withdrawal even when a local stale-request was set while active', async () => {
    boundary.localStatus = 'stale-request';
    const snapshot = await exportSnapshot();
    expect(snapshot.coverage.scope).toBe('cloud-and-device');
    expect(boundary.trustedExport).toHaveBeenCalledTimes(1);
    expect(boundary.directRootRead).not.toHaveBeenCalled();
    expect(boundary.controlRead).not.toHaveBeenCalled();
  });

  it('blocks every cloud backup request before the offline local-only consent reconciles', async () => {
    boundary.localStatus = 'active';
    boundary.offlineReaccept = true;
    await expect(exportSnapshot()).rejects.toThrow('solo sul dispositivo');
    expect(boundary.serverRead).not.toHaveBeenCalled();
    expect(boundary.trustedExport).not.toHaveBeenCalled();
    expect(boundary.directRootRead).not.toHaveBeenCalled();
    expect(boundary.controlRead).not.toHaveBeenCalled();
  });

  it('allows verified server reacceptance recovery to read cloud even with the local intent retained', async () => {
    boundary.localStatus = 'recovery-required';
    boundary.offlineReaccept = true;
    boundary.serverStatus = 'active';
    await exportSnapshot();
    expect(boundary.serverRead).toHaveBeenCalledTimes(1);
    expect(boundary.directRootRead).toHaveBeenCalledTimes(1);
  });

  it('uses the direct Firestore read path for locally active consent; Rules authorization is tested separately', async () => {
    boundary.localStatus = 'active';
    await exportSnapshot();
    expect(boundary.serverRead).not.toHaveBeenCalled();
    expect(boundary.trustedExport).not.toHaveBeenCalled();
    expect(boundary.directRootRead).toHaveBeenCalledTimes(1);
    expect(boundary.controlRead).toHaveBeenCalledTimes(2);
  });
});
