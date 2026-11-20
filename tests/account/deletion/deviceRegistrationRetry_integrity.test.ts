import { describe, expect, it, vi } from 'vitest';
import { deviceRegistrationMocks, loadSubject, user } from './deviceRegistrationRetryFixture';

const { firebase } = deviceRegistrationMocks;

describe('Device recovery: corrupted credentials and owner isolation', () => {
  it('rejects a completed device proof for another UID without clearing the credential', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    const raw = JSON.stringify([{ uid: 'user-a', token: 'A'.repeat(43) }]);
    localStorage.setItem('logbook_deletion_recovery_devices_v1', raw);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      uid: 'user-b', status: 'complete',
    }), { status: 200 })));
    const finalize = vi.fn();

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({
      operation: 'routine-check', phase: 'server-status', kind: 'invalid-response',
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBe(raw);
  });

  it('rejects corrupt proof JSON and preserves credentials instead of treating it as no deletion', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));

    await expect(recoverDeletedAccountOnThisDevice(vi.fn())).rejects.toMatchObject({
      phase: 'response-body',
      kind: 'invalid-response',
    });
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
  });

  it('rejects malformed local credentials without probing the server', async () => {
    const { recoverDeletedAccountOnThisDevice, DeletionRecoveryCredentialCorruptError } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'invalid' },
    ]));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(recoverDeletedAccountOnThisDevice(vi.fn())).rejects.toBeInstanceOf(DeletionRecoveryCredentialCorruptError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves a corrupt empty credential registry instead of treating it as absent', async () => {
    const {
      recoverDeletedAccountOnThisDevice,
      registerDeletionRecoveryDevice,
      removeDeletionRecoveryCredential,
      DeletionRecoveryCredentialCorruptError,
    } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', '');
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const finalize = vi.fn();

    await expect(recoverDeletedAccountOnThisDevice(finalize))
      .rejects.toBeInstanceOf(DeletionRecoveryCredentialCorruptError);
    const current = user('user-a');
    firebase.auth.currentUser = current;
    await expect(registerDeletionRecoveryDevice(current))
      .rejects.toBeInstanceOf(DeletionRecoveryCredentialCorruptError);
    expect(() => removeDeletionRecoveryCredential(current.uid))
      .toThrow(DeletionRecoveryCredentialCorruptError);
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBe('');
    expect(network).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it('rejects conflicting proof entries for the same owner without attempting recovery or registration', async () => {
    const {
      recoverDeletedAccountOnThisDevice,
      registerDeletionRecoveryDevice,
      DeletionRecoveryCredentialCorruptError,
    } = await loadSubject();
    const raw = JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
      { uid: 'user-a', token: 'B'.repeat(43) },
    ]);
    localStorage.setItem('logbook_deletion_recovery_devices_v1', raw);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const finalize = vi.fn();

    await expect(recoverDeletedAccountOnThisDevice(finalize))
      .rejects.toBeInstanceOf(DeletionRecoveryCredentialCorruptError);
    const current = user('user-a');
    firebase.auth.currentUser = current;
    await expect(registerDeletionRecoveryDevice(current))
      .rejects.toBeInstanceOf(DeletionRecoveryCredentialCorruptError);
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBe(raw);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });
});
