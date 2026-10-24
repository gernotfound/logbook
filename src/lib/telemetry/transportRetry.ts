import { isAccountDeletionPending } from '../sync/accountGate';
import {
  TELEMETRY_DISPATCH_TIMEOUT_MS,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  type TelemetryErrorPayload,
} from './contracts';
import { sendTelemetryToSentry } from '../sentryClient';

type UserIdProvider = () => string | null;

async function dispatchWithTimeout(
  payload: TelemetryErrorPayload,
): Promise<boolean> {
  const dispatchPromise = sendTelemetryToSentry('error', payload);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), TELEMETRY_DISPATCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([dispatchPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function dispatchTelemetryError(
  payload: TelemetryErrorPayload,
  getUserId: UserIdProvider
): Promise<boolean> {
  try {
    const uid = payload.userId;
    if (!uid || uid === 'anonymous' || uid !== getUserId() || isAccountDeletionPending(`user:${uid}`)) {
      return false;
    }

    return await dispatchWithTimeout(payload);
  } catch (err) {
    console.warn('[TelemetryHub] dispatchErrorToSentry failed non-blockingly:', err);
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
