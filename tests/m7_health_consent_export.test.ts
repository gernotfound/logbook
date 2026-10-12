import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  status: 'withdrawn' as 'withdrawn' | 'active',
  owner: 'owner-1',
  users: new Map<string, Record<string, unknown>>(),
  months: new Map<string, Record<string, unknown>>(),
  verify: vi.fn(async () => ({ uid: 'owner-1' })),
}));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' } }));
vi.mock('../server/accountDeletion/httpAuth', () => ({
  RequestAuthError: class RequestAuthError extends Error {
    constructor(message: string, readonly status: number = 401) { super(message); }
  },
  verifyRecoveryRegistrationRequester: mock.verify,
}));
vi.mock('../server/healthConsent/withdrawal', () => ({
  readHealthConsentState: vi.fn(async (uid: string) => {
    if (uid !== mock.owner) throw new Error('Unauthorized uid');
    return { status: mock.status, revision: 1 };
  }),
}));
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => ({ collection: (kind: string) => {
    if (kind !== 'users') throw new Error('Unexpected collection');
    return { doc: (uid: string) => ({
      get: async () => ({ exists: mock.users.has(uid), data: () => mock.users.get(uid) }),
      collection: (name: string) => {
        if (!['history_months','nutrition_months'].includes(name)) throw new Error('Invalid collection');
        const query = { cursor: '' as string, size: 100,
          orderBy: () => query,
          startAfter: (id: string) => { query.cursor = id; return query; },
          limit: (n: number) => { query.size = n; return query; },
          get: async () => {
            const docs = [...mock.months.entries()]
              .filter(([key]) => key.startsWith(uid + '/' + name + '/'))
              .map(([key, raw]) => ({ id: key.split('/').at(-1)!, data: () => raw }))
              .filter(d => d.id > query.cursor).sort((a,b) => a.id.localeCompare(b.id))
              .slice(0, query.size);
            return { docs };
          },
        };
        return query;
      },
    }) };
  } }),
}));

import { GET } from '../api/health-consent-export';
import { readWithdrawnHealthExportPage } from '../server/healthConsent/export';
const request = (params: string, origin='https://thelogbook.web.app') => new Request(
  'https://backend.example/api/health-consent-export?' + params, { headers: { origin } },
);

describe('server-mediated cloud export during consent withdrawal', () => {
  beforeEach(() => {
    mock.users.clear(); mock.months.clear(); mock.status = 'withdrawn'; mock.owner = 'owner-1';
    vi.clearAllMocks();
    mock.users.set('owner-1', { profile: { displayName: 'Owner' }, _schemaVersion: 1 });
    mock.users.set('other', { profile: { displayName: 'Other user' } });
    for(const [id,v] of [['2026-01','January'],['2026-02','February'],['2026-03','March']]) {
      mock.months.set('owner-1/history_months/' + id, { value: v });
    }
    mock.months.set('other/history_months/2026-02', { value: 'Private' });
  });

  it('requires trusted origin and authenticated owner before reading anything', async () => {
    expect((await GET(request('collection=root', 'https://invalid.example'))).status).toBe(403);
    expect(mock.verify).not.toHaveBeenCalled();
    const response = await GET(request('collection=root'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://thelogbook.web.app');
    expect((await response.json()).documents).toEqual([{ path: '', data: mock.users.get('owner-1') }]);
  });
  it('refuses direct privileged export when the consent is active', async () => {
    mock.status = 'active';
    await expect(readWithdrawnHealthExportPage('owner-1', 'root', null)).rejects.toThrow('only during withdrawal');
    expect((await GET(request('collection=root'))).status).toBe(503);
  });
  it('paginates all months in stable document-ID order with an exact cursor', async () => {
    const first = await GET(request('collection=history_months'));
    expect(first.status).toBe(200);
    const one = await first.json();
    expect(one.documents.map((doc: {path:string})=>doc.path)).toEqual(['history_months/2026-01','history_months/2026-02']);
    expect(one.nextCursor).toBe('2026-02');
    const second = await GET(request('collection=history_months&after=2026-02'));
    const two = await second.json();
    expect(two.documents).toEqual([{path:'history_months/2026-03',data:{value:'March'}}]);
    expect(two.nextCursor).toBeNull();
  });
  it('rejects traversal, unknown sections and cursor injection', async () => {
    for (const query of [
      'collection=account_deletions', 'collection=health_consent_withdrawals',
      'collection=history_months&after=../admin', 'collection=root&after=2026-01',
    ]) expect((await GET(request(query))).status).toBe(400);
  });
  it('never reads another account even when it has similarly named documents', async () => {
    const response = await readWithdrawnHealthExportPage('owner-1','history_months',null);
    expect(response.documents.every(doc=>doc.data.value !== 'Private')).toBe(true);
  });
});
