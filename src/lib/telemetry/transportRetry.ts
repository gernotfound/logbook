import { doc, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import { isAccountDeletionPending } from '../sync/accountGate';
import { computeErrorHash } from '../telemetrySanitizer';
import {
  FIRESTORE_DISPATCH_TIMEOUT_MS,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
} from './contracts';
import { sanitizeTelemetryDetails } from './detailSanitizer';

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

    const errorId = payload.id || `err_${payload.hash || computeErrorHash(payload.type, payload.message)}`;
    const docRef = doc(getDb(), 'users', uid, 'telemetry_errors', errorId);

    const firestorePayload: Record<string, any> = {
      timestamp: payload.timestamp || payload.firstSeen || Date.now(),
      type: payload.type,
      message: payload.message,
      context: payload.context,
      userId: uid,
      sessionId: payload.sessionId,
      count: payload.count,
      firstSeen: payload.firstSeen,
      lastSeen: payload.lastSeen,
      source: payload.source,
    };

    if (payload.stack) {
      firestorePayload.stack = payload.stack;
    }
    if (payload.componentStack) {
      firestorePayload.componentStack = payload.componentStack;
    }

    const writePromise = setDoc(docRef, firestorePayload, { merge: true });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Telemetry error dispatch timeout')), FIRESTORE_DISPATCH_TIMEOUT_MS)
    );

    await Promise.race([writePromise, timeoutPromise]);
    return true;
  } catch (err) {
    console.warn('[TelemetryHub] dispatchErrorToFirestore failed non-blockingly:', err);
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

    const eventId = payload.id || `evt_${payload.timestamp}_${Math.random().toString(36).slice(2, 9)}`;
    const docRef = doc(getDb(), 'users', uid, 'telemetry_events', eventId);

    const firestorePayload: Record<string, any> = {
      timestamp: payload.timestamp,
      type: payload.type,
      context: payload.context,
      userId: uid,
      sessionId: payload.sessionId,
    };

    if (payload.details !== undefined) {
      firestorePayload.details = sanitizeTelemetryDetails(payload.details);
    }

    const writePromise = setDoc(docRef, firestorePayload, { merge: true });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Telemetry event dispatch timeout')), FIRESTORE_DISPATCH_TIMEOUT_MS)
    );

    await Promise.race([writePromise, timeoutPromise]);
    return true;
  } catch (err) {
    console.warn('[TelemetryHub] dispatchEventToFirestore failed non-blockingly:', err);
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
