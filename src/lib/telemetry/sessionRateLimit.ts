import { auth } from '../firebase';
import { computeErrorHash, scrubPII } from '../telemetrySanitizer';
import {
  MAX_ACTIVE_RATE_LIMITERS,
  RATE_LIMIT_WINDOW_MS,
  SESSION_ID_KEY,
  type RateLimitEntry,
} from './contracts';
import { createTelemetryId } from './id';

export class TelemetrySessionState {
  private customUserId: string | null | undefined = undefined;
  private inMemorySessionId: string | null = null;

  constructor() {
    this.inMemorySessionId = this.getOrCreateSessionId();
  }

  public setUserId(userId: string | null | undefined): void {
    this.customUserId = userId;
  }

  public getUserId(): string | null {
    if (this.customUserId !== undefined) {
      return this.customUserId;
    }

    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('logbook_is_guest') === 'true') {
        return null;
      }
      if (typeof auth !== 'undefined' && auth && auth.currentUser) {
        return auth.currentUser.uid;
      }
    } catch {
      // Telemetry identity resolution is best-effort.
    }

    return 'anonymous';
  }

  public getSessionId(): string {
    if (this.inMemorySessionId) {
      return this.inMemorySessionId;
    }
    return this.getOrCreateSessionId();
  }

  private getOrCreateSessionId(): string {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(SESSION_ID_KEY);
        if (stored) {
          this.inMemorySessionId = stored;
          return stored;
        }

        const newId = createTelemetryId('sess');
        sessionStorage.setItem(SESSION_ID_KEY, newId);
        this.inMemorySessionId = newId;
        return newId;
      }
    } catch {
      // Fall back to an in-memory session identifier.
    }

    if (!this.inMemorySessionId) {
      this.inMemorySessionId = createTelemetryId('sess');
    }
    return this.inMemorySessionId;
  }

  public rotateSessionId(): void {
    // A tab may host multiple accounts; never link their diagnostics by session ID.
    const nextId = createTelemetryId('sess');
    this.inMemorySessionId = nextId;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SESSION_ID_KEY, nextId);
      }
    } catch {
      // Retain the isolated in-memory ID when session storage is unavailable.
    }
  }

  public reset(): void {
    this.customUserId = undefined;
    this.inMemorySessionId = null;
  }
}

export function isTelemetryOffline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return !navigator.onLine;
  }
  return false;
}

export class TelemetryRateLimitState {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly hashCache = new Map<string, { hash: string; scrubbed: string }>();

  public getFingerprint(type: string, message: string): { hash: string; scrubbed: string } {
    const cacheKey = `${type}:${message}`;
    const cached = this.hashCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const scrubbed = scrubPII(message);
    const hash = computeErrorHash(type, scrubbed);
    if (this.hashCache.size >= 512) {
      const firstKey = this.hashCache.keys().next().value;
      if (firstKey) {
        this.hashCache.delete(firstKey);
      }
    }
    const fingerprint = { hash, scrubbed };
    this.hashCache.set(cacheKey, fingerprint);
    return fingerprint;
  }

  public getActive(hash: string, now: number): RateLimitEntry | undefined {
    const entry = this.entries.get(hash);
    if (!entry) return undefined;

    if (now - entry.firstSeen >= RATE_LIMIT_WINDOW_MS) {
      if (entry.timerId) clearTimeout(entry.timerId);
      this.entries.delete(hash);
      return undefined;
    }

    return entry;
  }

  public get(hash: string): RateLimitEntry | undefined {
    return this.entries.get(hash);
  }

  public add(hash: string, entry: RateLimitEntry): void {
    if (this.entries.size >= MAX_ACTIVE_RATE_LIMITERS) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        const oldest = this.entries.get(oldestKey);
        if (oldest?.timerId) clearTimeout(oldest.timerId);
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(hash, entry);
  }

  public delete(hash: string): void {
    this.entries.delete(hash);
  }

  public values(): IterableIterator<RateLimitEntry> {
    return this.entries.values();
  }

  public clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.timerId) clearTimeout(entry.timerId);
    }
    this.entries.clear();
  }

  public takeAll(): RateLimitEntry[] {
    const entries = Array.from(this.entries.values());
    this.clear();
    return entries;
  }

  public get count(): number {
    return this.entries.size;
  }

  public reset(): void {
    this.clear();
    this.hashCache.clear();
  }
}
