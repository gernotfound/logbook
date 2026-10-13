import { beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../src/lib/firebase';
import { useAppStore } from '../src/store/useAppStore';
import { defaultMockUserData } from './setup';

describe('unowned business data cannot be relabelled by the next account', () => {
  beforeEach(() => {
    (auth as any).currentUser = { uid: 'account-b' };
    localStorage.clear();
    useAppStore.getState().resetStore({ force: true });
    useAppStore.setState({ userData: structuredClone(defaultMockUserData),
      dataOwner: null, localWorkout: null, localPersistenceBlocked: false });
  });

  it('refuses to publish or write a workout from an ownerless snapshot', () => {
    expect(() => useAppStore.getState().setLocalWorkout({
      id: 'a-private-workout', date: '2026-10-13', exercises: [],
    } as any)).toThrow(/non attribuito/i);
    expect(useAppStore.getState().localWorkout).toBeNull();
  });

  it('does not optimistically commit business operations under B without an owner', async () => {
    const previous = useAppStore.getState().userData;
    await expect(useAppStore.getState().dispatchDomainOperation({
      type: 'profile.patch', patch: { height: '180' },
    })).rejects.toThrow(/proprietario/i);
    expect(useAppStore.getState().userData).toBe(previous);
  });

  it('refuses a bulk snapshot change until ownership is established', () => {
    useAppStore.getState().setUserData({ ...defaultMockUserData, profile: { height: '180' } });
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(useAppStore.getState().userData?.profile?.height).not.toBe('180');
  });
});
