import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    reportKindeCandidateForegroundActivity } from './kindeCandidateClient';

const SUCCESS_INTERVAL_MS = 10 * 60 * 1000;
const FAILURE_INTERVAL_MS = 60 * 1000;

type AttemptOutcome = 'recorded' | 'observed' | 'skipped' | 'unavailable';

/**
 * One reporter per observed browser session, retained across identity refreshes
 * with the same CSRF witness. No timer, persistent marker, automatic replay or
 * listener: only an explicit foreground caller may request an observation.
 * Cooldown measures request frequency, never the server's inactivity clock.
 */
export function createKindeCandidateActivityReporter({
    expectedCsrfToken, send = fetch, browserCookies = () => document.cookie,
}: {
    expectedCsrfToken: string; send?: typeof fetch; browserCookies?: () => string;
}) {
    const fence = captureKindeCandidateSessionFence({ stillCurrent: () => true, browserCookies });
    if (fence.csrfToken !== expectedCsrfToken) throw new KindeCandidateBoundaryError();

    let running = false;
    let nextAttemptAt = 0;

    return async (stillCurrent: () => boolean): Promise<AttemptOutcome> => {
        const current = () => {
            try {
                return stillCurrent() === true && fence.stillCurrent()
                    && document.visibilityState === 'visible' && navigator.onLine !== false;
            } catch { return false; }
        };
        if (!current() || running || performance.now() < nextAttemptAt) return 'skipped';

        running = true;
        let delay = FAILURE_INTERVAL_MS;
        try {
            const outcome = await reportKindeCandidateForegroundActivity({
                expectedCsrfToken, stillCurrent: current, send, browserCookies,
            });
            if (!current()) return 'unavailable';
            delay = SUCCESS_INTERVAL_MS;
            return outcome;
        } catch {
            // A lost response may have written a marker. It is not a receipt;
            // no retry is scheduled and only a fresh foreground action can try.
            return 'unavailable';
        } finally {
            nextAttemptAt = performance.now() + delay;
            running = false;
        }
    };
}
