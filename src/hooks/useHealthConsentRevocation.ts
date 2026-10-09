import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getDb } from '../lib/firebase';
import {
  HEALTH_CONSENT_REVOCATION_EVENT,
  healthConsentRevocationKey,
  markHealthConsentRevocation,
  readHealthConsentRevocation,
  type HealthConsentRevocationStatus,
} from '../lib/healthConsentRevocation';

export type HealthConsentGateStatus = HealthConsentRevocationStatus | 'unavailable';

export function useHealthConsentRevocation(owner: string | null): HealthConsentGateStatus {
  const [status, setStatus] = useState<HealthConsentGateStatus>('none');

  useEffect(() => {
    if (!owner) {
      setStatus('none');
      return;
    }
    const refresh = () => {
      try { setStatus(readHealthConsentRevocation(owner)); }
      catch { setStatus('unavailable'); }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === healthConsentRevocationKey(owner) || event.key === null) refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(HEALTH_CONSENT_REVOCATION_EVENT, refresh);
    refresh();

    let unsubscribe: (() => void) | undefined;
    if (owner.startsWith('user:')) {
      try {
        const uid = owner.slice(5);
        unsubscribe = onSnapshot(
          doc(getDb(), 'health_consent_revocations', uid),
          snapshot => {
            if (snapshot.exists()) {
              try { markHealthConsentRevocation(owner, 'confirmed'); }
              catch { setStatus('unavailable'); }
            }
          },
          error => {
            // An offline device cannot learn the state of another device until
            // it reconnects. A server-side denial is not a benign offline state.
            if (error.code !== 'unavailable') setStatus('unavailable');
          },
        );
      } catch {
        setStatus('unavailable');
      }
    }

    return () => {
      unsubscribe?.();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(HEALTH_CONSENT_REVOCATION_EVENT, refresh);
    };
  }, [owner]);

  return status;
}
