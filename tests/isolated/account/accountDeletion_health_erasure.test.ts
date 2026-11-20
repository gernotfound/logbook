import { describe, expect, it, vi } from 'vitest';
import { deletionMocks, disk, response, completeHealthProof } from './accountDeletionFixture';
import { get } from 'idb-keyval';
import { purgeAllLocalUserData, purgeCompletedAccountLocalData, purgeCompletedHealthDataLocal, resumeInterruptedLocalPurge } from '../../../src/lib/db/db_account';
import { beginLocalPurge, isLocalPurgePending } from '../../../src/lib/sync/localPurgeFence';

const boundary = deletionMocks.boundary;

describe('Deletion: health erasure and cross-owner local fences', () => {
it('revalidates health-erasure completion only after acquiring the owner lock', async () => {
    let unlock!: () => void;
    const locked = new Promise<void>(resolve => { unlock = resolve; });
    let lockEntered = false;
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, action: () => Promise<unknown>) => {
        await locked;
        lockEntered = true;
        return action();
    } } });
    boundary.auth.currentUser.getIdToken = vi.fn(async () => 'firebase-id-token');
    boundary.fetch.mockResolvedValueOnce(completeHealthProof())
        .mockResolvedValueOnce(response(200, {
            status: 'complete', complete: true, localPurgeAuthorized: false,
        }));

    const work = purgeCompletedHealthDataLocal('user:a');
    await vi.waitFor(() => expect(boundary.fetch).toHaveBeenCalledTimes(1));
    expect(lockEntered).toBe(false);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    unlock();

    await expect(work).rejects.toThrow('non è verificata');
    expect(boundary.fetch).toHaveBeenCalledTimes(2);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(isLocalPurgePending('user:a')).toBe(false);
});

it('preserves the original archive if the trusted recheck under lock is unavailable', async () => {
    boundary.auth.currentUser.getIdToken = vi.fn(async () => 'firebase-id-token');
    boundary.fetch.mockResolvedValueOnce(completeHealthProof())
        .mockResolvedValueOnce(response(503, { error: 'Temporaneamente non disponibile' }));

    await expect(purgeCompletedHealthDataLocal('user:a'))
        .rejects.toThrow('Non è stato possibile verificare la ricevuta');
    expect(boundary.fetch).toHaveBeenCalledTimes(2);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(isLocalPurgePending('user:a')).toBe(false);
});

it('finishes data-only erasure after two current trusted proofs, preserving another owner', async () => {
    boundary.auth.currentUser.getIdToken = vi.fn(async () => 'firebase-id-token');
    boundary.fetch.mockImplementation(async () => completeHealthProof());

    await purgeCompletedHealthDataLocal('user:a');

    expect(boundary.fetch).toHaveBeenCalledTimes(2);
    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(isLocalPurgePending('user:a')).toBe(true);
});

it('does not self-abort data erasure after removing its own consent markers', async () => {
    boundary.auth.currentUser.getIdToken = vi.fn(async () => 'firebase-id-token');
    boundary.fetch.mockImplementation(async () => completeHealthProof());
    disk.set('logbook:v2:user:a:health-consent-generation', '1');
    disk.set('logbook:v2:user:a:health-consent-withdrawal', 'withdrawn');

    await purgeCompletedHealthDataLocal('user:a');

    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(disk.has('logbook:v2:user:a:health-consent-generation')).toBe(false);
    expect(disk.has('logbook:v2:user:a:health-consent-withdrawal')).toBe(false);
    expect(isLocalPurgePending('user:a')).toBe(true);
});

it('retains old account ciphertext and shared drafts if another account activates while waiting for the purge lock', async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const requested = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal('navigator', { locks: { request: async (_key: string, _opts: unknown, action: () => Promise<unknown>) => {
        entered();
        await waiting;
        return action();
    } } });
    const sharedKey = 'logbook:v2:user:b:draft:workout';
    disk.set(sharedKey, 'new-owner-workout');
    const work = purgeCompletedAccountLocalData('user:a');
    await requested;
    boundary.auth.currentUser = { uid: 'b' };
    release();
    await expect(work).rejects.toThrow('La pulizia locale resta sospesa');
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(disk.get(sharedKey)).toBe('new-owner-workout');
    expect(isLocalPurgePending('user:a')).toBe(false);
});

it('keeps an interrupted deletion fenced when a guest starts before retry', async () => {
    disk.set('logbook_is_guest', 'true');
    disk.set('logbook:v2:guest:draft:workout', 'guest-workout');
    await expect(purgeCompletedAccountLocalData('user:a')).rejects.toThrow('La pulizia locale resta sospesa');
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(disk.get('logbook:v2:guest:draft:workout')).toBe('guest-workout');
    expect(isLocalPurgePending('user:a')).toBe(false);
});

it('does not resume a fenced account purge after a different account has logged in', async () => {
    beginLocalPurge('user:a');
    disk.set('logbook:v2:user:b:draft:workout', 'new-owner-workout');
    boundary.auth.currentUser = { uid: 'b' };

    await expect(resumeInterruptedLocalPurge('user:a')).rejects.toThrow('La pulizia locale resta sospesa');
    await expect(purgeAllLocalUserData('user:a')).rejects.toThrow('La pulizia locale resta sospesa');

    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(disk.get('logbook:v2:user:b:draft:workout')).toBe('new-owner-workout');
    expect(isLocalPurgePending('user:a')).toBe(true);
});

it('preserves an interrupted account purge if an owner hint switches before Auth resolves', async () => {
    beginLocalPurge('user:a');
    disk.set('logbook_authenticated_owner', 'user:b');
    disk.set('logbook:v2:user:b:draft:workout', 'from-other-account');
    boundary.auth.currentUser = null;

    await expect(resumeInterruptedLocalPurge('user:a')).rejects.toThrow('La pulizia locale resta sospesa');

    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(disk.get('logbook:v2:user:b:draft:workout')).toBe('from-other-account');
    expect(isLocalPurgePending('user:a')).toBe(true);
});

it('refuses to resume an old guest purge over a newly active guest generation', async () => {
    beginLocalPurge('guest');
    boundary.auth.currentUser = null;
    disk.set('logbook_is_guest', 'true');
    disk.set('logbook_guest_session_id_v1', 'new-guest-generation');
    disk.set('logbook:v2:guest:draft:measurement', 'new-guest-draft');

    await expect(resumeInterruptedLocalPurge('guest')).rejects.toThrow('La pulizia locale resta sospesa');

    expect(disk.get('logbook:v2:guest:draft:measurement')).toBe('new-guest-draft');
    expect(isLocalPurgePending('guest')).toBe(true);
});

it('completes a fenced owner purge when the same owner is still active', async () => {
    beginLocalPurge('user:a');

    await resumeInterruptedLocalPurge('user:a');

    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(isLocalPurgePending('user:a')).toBe(true);
});
});
