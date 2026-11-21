import assert from 'node:assert/strict';
import { test } from 'node:test';
import apiWorker from '../../cloudflare/api/worker.mjs';
import { acceptance, withdrawal, fixture, request, call, count } from './cf05-consent-fixture.mjs';

void test('unbound, aliased or sealed independent consent registry cannot start first consent', async () => {
  const f = await fixture();
  try {
    for (const RECOVERY_DB of [undefined, f.db]) {
      f.env.RECOVERY_DB = RECOVERY_DB;
      assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    }
    f.env.RECOVERY_DB = f.recoveryDb;
    f.registry.exec("UPDATE recovery_control SET mode='sealed',generation=3 WHERE singleton=1");
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    assert.equal(count(f.registry, 'recovery_owner_fences'), 0);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 0);
  } finally { f.close(); }
});

void test('lost first-consent batch response can be confirmed from both committed stores', async () => {
  const f = await fixture();
  try {
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async statements => {
      await batch(statements);
      throw new Error('synthetic lost response after SQL commit');
    };
    const accepted = await call(f, '/v1/consent/initial', { body: acceptance });
    assert.equal(accepted.status, 200);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
    assert.equal(f.registry.prepare('SELECT status FROM recovery_owner_fences').get().status, 'active');
  } finally { f.close(); }
});

void test('status reconciles a stranded first consent only with verified session CSRF', async () => {
  const f = await fixture();
  try {
    f.registry.exec(`CREATE TRIGGER synthetic_no_promote BEFORE UPDATE ON recovery_owner_fences
      WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`);
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
    assert.equal(f.registry.prepare('SELECT status FROM recovery_owner_fences').get().status, 'pending');
    assert.equal((await apiWorker.fetch(request('/v1/sync/control', f, { body: {} }), f.env)).status, 503);
    f.registry.exec('DROP TRIGGER synthetic_no_promote');
    assert.equal((await call(f, '/v1/consent/status', { csrf: '' })).status, 503);
    assert.equal(f.registry.prepare('SELECT status FROM recovery_owner_fences').get().status, 'pending');
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'active');
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'active');
    assert.equal(f.registry.prepare('SELECT change_seq FROM recovery_owner_fences').get().change_seq, 2);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
  } finally { f.close(); }
});

void test('withdrawal denies a stranded first consent without ever promoting it to active', async () => {
  const f = await fixture();
  try {
    f.registry.exec(`CREATE TRIGGER synthetic_no_promote BEFORE UPDATE ON recovery_owner_fences
      WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`);
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    assert.deepEqual({ ...f.registry.prepare(
      'SELECT status,consent_revision,change_seq FROM recovery_owner_fences WHERE uid=?',
    ).get(f.uid) }, { status: 'withdrawn', consent_revision: 1, change_seq: 3 });
    f.registry.exec('DROP TRIGGER synthetic_no_promote');
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'withdrawn');
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 409);
  } finally { f.close(); }
});
