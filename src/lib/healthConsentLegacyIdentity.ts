import type { User } from 'firebase/auth';

// Legacy consent has a synchronous Auth boundary, but the guest and Kinde
// shells must not initialize Firebase merely by importing consent policy.
// Only the mounted legacy AuthProvider may supply this reader.
let reader: (() => User | null) | null = null;
let leases = 0;

export function installLegacyHealthConsentIdentity(next: () => User | null): () => void {
  if (reader !== null && reader !== next) throw new Error('Sessione consenso legacy già associata.');
  reader = next;
  leases += 1;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (reader !== next) return;
    leases -= 1;
    if (leases === 0) reader = null;
  };
}

// Absence of a mounted provider is never an authenticated consent grant.
export function readLegacyHealthConsentUser(): User | null {
  return reader?.() ?? null;
}
