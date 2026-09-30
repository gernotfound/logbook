import { isAccountDeletionPending } from '../sync/accountGate';
import {
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
} from './contracts';
import { sanitizeTelemetryDetails } from './detailSanitizer';
import { sendTelemetryToSentry } from '../sentryClient';

type UserIdProvider = () => string | null;

export async function dispatchTelemetryError(
  payload: TelemetryErrorPayload,
  getUserId: UserIdProvider
): Promise<boolean> {
  try {
    const uid = payload.userId;
    if (!uid || uid === 'anonymous' || uid !== getUserId() || isAccountDeletionPending(`user:${uid}`)) {
      return false;
    }

    return await sendTelemetryToSentry('error', payload);
  } catch (err) {
    console.warn('[TelemetryHub] dispatchErrorToSentry failed non-blockingly:', err);
    return false;
  }
}

export async function dispatchTelemetryEvent(
  payload: TelemetryEventPayload,
  getUserId: UserIdProvider
): Promise<boolean> {
  try {
    const uid = payload.userId;
    if (!uid || uid === 'anonymous' || uid !== getUserId() || isAccountDeletionPending(`user:${uid}`)) {
      return false;
    }

    const sanitizedPayload: TelemetryEventPayload = {
      ...payload,
      details: payload.details === undefined ? undefined : sanitizeTelemetryDetails(payload.details),
    };

    // Accepted at the boundary but intentionally not emitted externally.
    return await sendTelemetryToSentry('event', sanitizedPayload);
  } catch (err) {
    console.warn('[TelemetryHub] dispatchEventToSentry failed non-blockingly:', err);
    return false;
  }
}

export class TelemetryRetryScheduler {
  private retryCount = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  public schedule(callback: () => void): void {
    if (this.timerId) return;

    this.retryCount = Math.min(5, this.retryCount + 1);
    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      INITIAL_RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1)
    );

    this.timerId = setTimeout(() => {
      this.timerId = null;
      callback();
    }, delay);
  }

  public clear(): void {
    this.retryCount = 0;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
