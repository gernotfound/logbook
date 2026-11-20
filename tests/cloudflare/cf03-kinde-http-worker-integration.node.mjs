import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import kindeHttpWorker from '../../cloudflare/auth/kinde-http-worker.mjs';
import apiWorker from '../../cloudflare/api/worker.mjs';
import { routeCandidateFirstPartyApi } from '../../cloudflare/first-party-api-candidate.mjs';
import { fixture, ORIGIN, ISSUER, SESSION, START, CALLBACK, LOGOUT, cloudCall, acceptance } from './kinde-http-worker-fixture.mjs';

void test('Kinde callback crosses consent and D1 replica gates only after explicit verified acceptance', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    const trustedSession = await (await f.handler(f.post(SESSION, login.cookie), f.env)).json();
    assert.deepEqual(await cloudCall(f, '/v1/consent/status', login), {
      status: 200, body: { uid: trustedSession.uid,
        status: 'unregistered', revision: 0, fenceEpoch: 1 },
    });
    assert.equal((await cloudCall(f, '/v1/sync/control', login, {})).status, 401);
    assert.equal((await cloudCall(f, '/v1/consent/initial', login, acceptance, 'invalid-csrf')).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_subjects').get().n, 0);

    const accepted = await cloudCall(f, '/v1/consent/initial', login, acceptance);
    assert.equal(accepted.status, 200);
    assert.deepEqual({
      uid: accepted.body.uid, status: accepted.body.status, revision: accepted.body.revision,
      fenceEpoch: accepted.body.fenceEpoch,
    }, { uid: trustedSession.uid, status: 'active', revision: 1, fenceEpoch: 1 });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM health_consent_acceptances').get().n, 1);
    assert.equal((await cloudCall(f, '/v1/consent/initial', login, acceptance)).status, 409);
    const session = await f.handler(f.post(SESSION, login.cookie), f.env);
    assert.equal((await session.json()).healthConsentRevision, 1);
    assert.deepEqual(await cloudCall(f, '/v1/sync/control', login, {}), {
      status: 200, body: { uid: trustedSession.uid, revision: 0, consentRevision: 1, fenceEpoch: 1, replicas: {} },
    });

    const claim = {
      mutationId: 'kinde-synthetic-claim-0001', expectedRevision: 0,
      expectedFenceEpoch: 1, consentRevision: 1,
      candidateReplicaId: 'kinde-synthetic-device-0001',
      currentReplica: null, checkpointClock: {},
    };
    assert.equal((await cloudCall(f, '/v1/sync/replica/claim', login, claim, 'invalid-csrf')).status, 403);
    // The current D1 triggers refuse membership writes even after valid Kinde
    // and explicit consent until this owner has a durable, wrapped ADK.
    const withoutKey = await cloudCall(f, '/v1/sync/replica/claim', login, claim);
    assert.deepEqual(withoutKey, { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_writable_cloud_key').get().n, 0);

    const key = await cloudCall(f, '/v1/cloud-key/sync', login);
    assert.equal(key.status, 200);
    assert.equal(key.body.format, 'thelogbook-account-data-key');
    assert.equal(Buffer.from(key.body.key, 'base64').length, 32);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_account_keys').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_key_issuance').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_writable_cloud_key').get().n, 1);
    const registered = await cloudCall(f, '/v1/sync/replica/claim', login, claim);
    assert.equal(registered.status, 200);
    assert.equal(registered.body.action, 'register');
    assert.equal(registered.body.replica.replicaId, claim.candidateReplicaId);
    assert.equal((await cloudCall(f, '/v1/sync/control', login, {})).body.revision, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 1);
  } finally { f.close(); }
});

void test('Kinde consent withdrawal fences replica but permits status and session logout', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    assert.equal((await cloudCall(f, '/v1/consent/initial', login, acceptance)).status, 200);
    const withdrawn = await cloudCall(f, '/v1/consent/withdraw', login, {
      action: 'withdraw', expectedRevision: 1, confirmsErasure: true,
    });
    assert.deepEqual(withdrawn, { status: 200, body: {
      status: 'withdrawn', revision: 1, fenceEpoch: 1, deletionStatus: 'pending',
    } });
    assert.equal((await cloudCall(f, '/v1/sync/control', login, {})).status, 401);
    assert.equal((await cloudCall(f, '/v1/consent/status', login)).body.status, 'withdrawn');
    assert.equal(f.sqlite.prepare('SELECT status FROM health_erasure_jobs').get().status, 'pending');
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 200);
    assert.equal((await f.handler(f.post(LOGOUT, login.cookie, login.csrf), f.env)).status, 200);
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 401);
    assert.equal((await cloudCall(f, '/v1/consent/status', login)).status, 401);
    assert.equal(f.sqlite.prepare('SELECT status FROM health_erasure_jobs').get().status, 'pending');
  } finally { f.close(); }
});

void test('Kinde signed subjects retain separate D1 consent and replica registers', async () => {
  const f = await fixture();
  try {
    const a = await f.login();
    const principalA = await (await f.handler(f.post(SESSION, a.cookie), f.env)).json();
    assert.equal((await cloudCall(f, '/v1/consent/initial', a, acceptance)).status, 200);
    const claim = {
      mutationId: 'kinde-synthetic-claim-owner-a', expectedRevision: 0,
      expectedFenceEpoch: 1, consentRevision: 1,
      candidateReplicaId: 'kinde-synthetic-device-owner-a',
      currentReplica: null, checkpointClock: {},
    };
    assert.deepEqual(await cloudCall(f, '/v1/sync/replica/claim', a, claim),
      { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
    assert.equal((await cloudCall(f, '/v1/cloud-key/sync', a)).status, 200);
    assert.equal((await cloudCall(f, '/v1/sync/replica/claim', a, claim)).status, 200);
    f.setSubject('kp_other_synthetic_user_20261114');
    const b = await f.login();
    const principalB = await (await f.handler(f.post(SESSION, b.cookie), f.env)).json();
    assert.notEqual(principalA.uid, principalB.uid);
    assert.equal((await cloudCall(f, '/v1/sync/control', b, {})).status, 401);
    assert.deepEqual((await cloudCall(f, '/v1/consent/status', b)).body,
      { uid: principalB.uid, status: 'unregistered', revision: 0, fenceEpoch: 1 });
    assert.equal((await cloudCall(f, '/v1/consent/initial', b, acceptance)).status, 200);
    assert.deepEqual((await cloudCall(f, '/v1/sync/control', b, {})).body.replicas, {});
    const claimB = {
      ...claim, mutationId: 'kinde-synthetic-claim-owner-b',
      candidateReplicaId: 'kinde-synthetic-device-owner-b',
    };
    assert.deepEqual(await cloudCall(f, '/v1/sync/replica/claim', b, claimB),
      { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 1);
    assert.equal((await cloudCall(f, '/v1/cloud-key/sync', b)).status, 200);
    assert.equal((await cloudCall(f, '/v1/sync/replica/claim', b, claimB)).status, 200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_account_keys').get().n, 2);
    assert.equal(Object.keys((await cloudCall(f, '/v1/sync/control', b, {})).body.replicas).length, 1);
    assert.equal(Object.keys((await cloudCall(f, '/v1/sync/control', a, {})).body.replicas).length, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM health_consent_acceptances').get().n, 2);
  } finally { f.close(); }
});

void test('first-party gateway completes synthetic Kinde → consent → ADK → D1 → logout with production Workers', async () => {
  const f = await fixture();
  try {
    // Exercise the real HTTP identity handler and private consent boundary
    // Workers and current canonical SQLite schemas behind the future gateway.
    // Token signing is synthetic; no request reaches a provider account.
    const gateway = {
      APP_ORIGIN: ORIGIN,
      KINDE_HTTP: { fetch: request => f.handler(request, f.env) },
      D1_API: { fetch: request => apiWorker.fetch(request, { ...f.env, API_ORIGIN: ORIGIN }) },
    };
    const through = request => routeCandidateFirstPartyApi(request, gateway);
    const start = await through(f.post(START));
    assert.equal(start.status, 303);
    const authorize = new URL(start.headers.get('location'));
    assert.equal(authorize.origin, ISSUER);
    f.setNonce(authorize.searchParams.get('nonce'));
    const browserBinding = start.headers.getSetCookie()[0].split(';')[0];
    const returned = await through(new Request(ORIGIN + CALLBACK
      + '?code=short&state=' + authorize.searchParams.get('state'), {
      headers: { cookie: browserBinding, 'sec-fetch-site': 'cross-site' },
    }));
    assert.equal(returned.status, 303);
    assert.equal(returned.headers.get('location'), ORIGIN + '/');
    const issuedCookies = returned.headers.getSetCookie();
    assert.equal(issuedCookies.length, 2);
    const cookie = issuedCookies.map(value => value.split(';')[0]).join('; ');
    const csrf = issuedCookies[1].split(';')[0].split('=')[1];
    const principal = await (await through(f.post(SESSION, cookie))).json();
    assert.equal(principal.authenticated, true);
    assert.equal(principal.emailVerified, true);
    assert.equal(principal.healthConsentRevision, 0);

    const api = async (route, payload, suppliedCsrf = csrf) => {
      const headers = {
        origin: ORIGIN, 'sec-fetch-site': 'same-origin',
        cookie, 'x-csrf-token': suppliedCsrf,
      };
      if (payload !== undefined) headers['content-type'] = 'application/json';
      const response = await through(new Request(ORIGIN + route, {
        method: 'POST', headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      }));
      return { status: response.status, body: await response.json() };
    };
    const streamed = async (route, chunks) => {
      const request = new Request(ORIGIN + route, {
        method: 'POST',
        headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin',
          cookie, 'x-csrf-token': csrf, 'content-length': '0' },
        body: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
            controller.close();
          },
        }),
        duplex: 'half',
      });
      const response = await through(request);
      return { status: response.status, body: await response.json() };
    };

    assert.deepEqual(await api('/v1/consent/status'), {
      status: 200, body: { uid: principal.uid, status: 'unregistered', revision: 0, fenceEpoch: 1 },
    });
    assert.deepEqual(await streamed('/v1/consent/status', [[], []]), {
      status: 200, body: { uid: principal.uid, status: 'unregistered', revision: 0, fenceEpoch: 1 },
    });
    assert.equal((await streamed('/v1/consent/status', [[32]])).status, 400);
    assert.equal((await api('/v1/sync/control', {})).status, 401);
    assert.equal((await api('/v1/consent/initial', acceptance, 'invalid-csrf')).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM health_consent_acceptances').get().n, 0);

    const consent = await api('/v1/consent/initial', acceptance);
    assert.equal(consent.status, 200);
    assert.equal(consent.body.uid, principal.uid);
    assert.equal((await (await through(f.post(SESSION, cookie))).json()).healthConsentRevision, 1);
    const claim = {
      mutationId: 'a'.repeat(20), expectedRevision: 0,
      expectedFenceEpoch: 1, consentRevision: 1,
      candidateReplicaId: 'b'.repeat(20),
      currentReplica: null, checkpointClock: {},
    };
    assert.deepEqual(await api('/v1/sync/replica/claim', claim),
      { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 0);
    // A forged empty Content-Length cannot release or provision an ADK.
    assert.equal((await streamed('/v1/cloud-key/sync', [[0]])).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_account_keys').get().n, 0);
    const key = await streamed('/v1/cloud-key/sync', [[], []]);
    assert.equal(key.status, 200);
    const repeatedKey = await api('/v1/cloud-key/sync');
    assert.equal(repeatedKey.status, 200);
    assert.equal(repeatedKey.body.key, key.body.key);
    assert.equal(Buffer.from(key.body.key, 'base64').length, 32);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_account_keys').get().n, 1);
    assert.equal((await api('/v1/sync/replica/claim', claim)).status, 200);
    assert.equal((await api('/v1/sync/control', {})).body.revision, 1);

    const withdrawal = await api('/v1/consent/withdraw', {
      action: 'withdraw', expectedRevision: 1, confirmsErasure: true,
    });
    assert.equal(withdrawal.status, 200);
    assert.equal(withdrawal.body.status, 'withdrawn');
    assert.equal((await api('/v1/sync/control', {})).status, 401);
    assert.equal(f.sqlite.prepare('SELECT status FROM health_erasure_jobs').get().status, 'pending');
    assert.equal((await through(f.post(LOGOUT, cookie, csrf))).status, 200);
    assert.equal((await through(f.post(SESSION, cookie))).status, 401);
    assert.equal((await api('/v1/consent/status')).status, 401);
  } finally { f.close(); }
});

void test('private Kinde Worker remains unrouted while frontend exposes only four OAuth endpoints', () => {
  const here = new URL('../../cloudflare/auth/', import.meta.url);
  const read = name => JSON.parse(readFileSync(new URL(name, here), 'utf8'));
  const candidate = read('wrangler.kinde.local.jsonc');
  const gate = read('wrangler.local.jsonc');
  const api = JSON.parse(readFileSync(new URL('../../cloudflare/api/wrangler.local.jsonc', import.meta.url), 'utf8'));
  const publicFrontend = JSON.parse(readFileSync(new URL('../../cloudflare/wrangler.jsonc', import.meta.url), 'utf8'));

  assert.equal(candidate.main, './kinde-http-worker.mjs');
  assert.equal(candidate.workers_dev, false);
  assert.equal(candidate.preview_urls, false);
  assert.equal(candidate.routes, undefined);
  assert.equal(candidate.route, undefined);
  assert.equal(candidate.vars.KINDE_CLIENT_SECRET, undefined);
  assert.equal(candidate.d1_databases[0].database_id, gate.d1_databases[0].database_id);
  assert.equal(candidate.d1_databases[0].database_id, api.d1_databases[0].database_id);
  assert.equal(candidate.d1_databases[0].database_name, gate.d1_databases[0].database_name);
  assert.equal(candidate.services[0].service, gate.name);
  assert.equal(candidate.ratelimits[0].name, 'AUTH_RATE_LIMITER');
  assert.deepEqual(publicFrontend.assets.run_worker_first, ['/api/auth/kinde/start', '/api/auth/kinde/callback', '/api/auth/session', '/api/auth/logout']);
  assert.equal(publicFrontend.main, './auth-proxy.mjs');
});


void test('module entrypoint is a safe candidate Worker with strict 404 on unsupported paths', async () => {
  const response = await kindeHttpWorker.fetch(new Request(ORIGIN + '/api/auth/unknown'), {});
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
