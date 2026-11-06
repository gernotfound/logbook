import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { trustedBackendUrl } from './backendApi';
import { captureSessionForOwner, isCurrentSession, userOwner } from './sync/session';

const REPORT_INTERVAL_MS = 60 * 60 * 1000;
const ERROR_RETRY_MS = 60 * 1000;

/** Observe only visible, authenticated foreground use; never send fitness data
 * or infer that a background synchronization represents an active user.
 */
export function watchAuthenticatedAccountActivity(user: User): () => void {
  if (import.meta.env.VITE_ACCOUNT_INACTIVITY_TRACKING !== 'true') return () => {};

  let stopped = false;
  let running = false;
  let lastAcknowledgedAt = 0;
  let nextRetryAt = 0;
  const controller = new AbortController();

  const current = () => !stopped
    && auth.currentUser === user
    && document.visibilityState === 'visible'
    && navigator.onLine !== false;

  const attempt = () => {
    const now = Date.now();
    if (!current() || running || now - lastAcknowledgedAt < REPORT_INTERVAL_MS || now < nextRetryAt) return;
    let session;
    try { session = captureSessionForOwner(userOwner(user.uid)); }
    catch { return; }
    if (!isCurrentSession(session)) return;

    running = true;
    void (async () => {
      try {
        await ensureAppCheck();
        const appCheck = await getLimitedUseAppCheckToken();
        const token = await user.getIdToken();
        if (!appCheck || !current() || !isCurrentSession(session)) return;
        const response = await fetch(trustedBackendUrl('/api/account-activity'), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'x-firebase-appcheck': appCheck },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!current() || !isCurrentSession(session)) return;
        if (response.status === 204) lastAcknowledgedAt = Date.now();
        else nextRetryAt = Date.now() + ERROR_RETRY_MS;
      } catch {
        if (current()) nextRetryAt = Date.now() + ERROR_RETRY_MS;
      } finally {
        running = false;
      }
    })();
  };

  window.addEventListener('pointerdown', attempt, { passive: true });
  window.addEventListener('keydown', attempt);
  window.addEventListener('focus', attempt);
  window.addEventListener('online', attempt);
  document.addEventListener('visibilitychange', attempt);
  attempt();

  return () => {
    stopped = true;
    controller.abort();
    window.removeEventListener('pointerdown', attempt);
    window.removeEventListener('keydown', attempt);
    window.removeEventListener('focus', attempt);
    window.removeEventListener('online', attempt);
    document.removeEventListener('visibilitychange', attempt);
  };
}
