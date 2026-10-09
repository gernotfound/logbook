import { act, renderHook } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHealthConsentRevocation } from '../src/hooks/useHealthConsentRevocation';
import { readHealthConsentRevocation } from '../src/lib/healthConsentRevocation';

const mockListener = () => {
  const calls = (onSnapshot as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const onNext = calls.at(-1)?.[1];
  if (typeof onNext !== 'function') throw new Error('Missing synthetic Firestore listener');
  return onNext as (snapshot: { exists: () => boolean }) => void;
};

describe('health-consent Firestore listener', () => {
  beforeEach(() => {
    vi.mocked(onSnapshot).mockClear();
    localStorage.clear();
  });

  it('suspends an online session when the server records a revocation from a second device', () => {
    const { result } = renderHook(() => useHealthConsentRevocation('user:owner-a'));
    expect(result.current).toBe('none');

    act(() => mockListener()({ exists: () => true }));
    expect(result.current).toBe('confirmed');
    expect(readHealthConsentRevocation('user:owner-a')).toBe('confirmed');
  });

  it('does not apply a previous account observer to a different signed-in owner', () => {
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string }) => useHealthConsentRevocation(owner),
      { initialProps: { owner: 'user:owner-a' } },
    );
    const previous = mockListener();

    rerender({ owner: 'user:owner-b' });
    expect(result.current).toBe('none');

    act(() => previous({ exists: () => true }));
    expect(readHealthConsentRevocation('user:owner-a')).toBe('confirmed');
    expect(readHealthConsentRevocation('user:owner-b')).toBe('none');
    expect(result.current).toBe('none');
  });
});
