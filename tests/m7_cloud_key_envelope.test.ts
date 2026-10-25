import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountKeyUnavailableError, wrapAccountDataKey, unwrapAccountDataKey,
} from '../server/cloudKeys/accountKeyEnvelope';

const secret = Buffer.alloc(32, 17);
const otherSecret = Buffer.alloc(32, 23);
const accountDataKey = () => Buffer.from(Array.from({ length: 32 }, (_, i) => i));

beforeEach(() => {
  vi.stubEnv('CLOUD_ACCOUNT_KEK_V1', secret.toString('base64'));
});
afterEach(() => vi.unstubAllEnvs());

describe('zero-cost versioned server ADK envelope', () => {
  it('seals a per-account key with AES-256-GCM and authenticates UID without any network calls', async () => {
    const wrapped = await wrapAccountDataKey('user-one', accountDataKey());
    expect(wrapped).toMatchObject({
      format: 'thelogbook-wrapped-account-key', version: 1, keyVersion: 1, uid: 'user-one',
    });
    expect(Buffer.from(wrapped.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(wrapped.tag, 'base64')).toHaveLength(16);
    expect(wrapped.ciphertext).not.toBe(accountDataKey().toString('base64'));
    expect(await unwrapAccountDataKey('user-one', wrapped)).toEqual(accountDataKey());
    const next = await wrapAccountDataKey('user-one', accountDataKey());
    expect(next.iv).not.toBe(wrapped.iv);
    expect(await unwrapAccountDataKey('user-one', next)).toEqual(accountDataKey());
  });

  it('blocks cross-owner release, ciphertext, IV, tag, metadata and version tampering', async () => {
    const original = await wrapAccountDataKey('user-one', accountDataKey());
    const corrupt = [
      { ...original, uid: 'user-two' },
      { ...original, version: 2 },
      { ...original, keyVersion: 2 },
      { ...original, iv: Buffer.alloc(12).toString('base64') },
      { ...original, ciphertext: Buffer.alloc(32, 123).toString('base64') },
      { ...original, tag: Buffer.alloc(16, 123).toString('base64') },
      { ...original, plaintext: accountDataKey().toString('base64') },
      { ...original, iv: 'invalid' },
      { ...original, ciphertext: '=' },
      { ...original, tag: '' },
      { ...original, format: 'legacy' },
    ];
    await expect(unwrapAccountDataKey('user-two', original))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    for (const sample of corrupt) {
      await expect(unwrapAccountDataKey('user-one', sample))
        .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    }
  });

  it('fails closed if the master secret is missing, malformed, changed or lost', async () => {
    const wrapped = await wrapAccountDataKey('user-one', accountDataKey());
    vi.stubEnv('CLOUD_ACCOUNT_KEK_V1', '');
    await expect(wrapAccountDataKey('user-one', accountDataKey()))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    await expect(unwrapAccountDataKey('user-one', wrapped))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    vi.stubEnv('CLOUD_ACCOUNT_KEK_V1', Buffer.alloc(24).toString('base64'));
    await expect(unwrapAccountDataKey('user-one', wrapped))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    vi.stubEnv('CLOUD_ACCOUNT_KEK_V1', otherSecret.toString('base64'));
    await expect(unwrapAccountDataKey('user-one', wrapped))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    vi.stubEnv('CLOUD_ACCOUNT_KEK_V1', secret.toString('base64'));
    expect(await unwrapAccountDataKey('user-one', wrapped)).toEqual(accountDataKey());
  });

  it('never accepts an invalid UID or non-32-byte account key', async () => {
    for (const uid of ['', 'with/slash', 'a'.repeat(129)]) {
      await expect(wrapAccountDataKey(uid, accountDataKey()))
        .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    }
    await expect(wrapAccountDataKey('user-one', Buffer.alloc(31)))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    await expect(wrapAccountDataKey('user-one', Buffer.alloc(33)))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
  });
});
