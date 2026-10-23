import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import {
  telemetryHub,
  type QueuedTelemetryItem,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';
import { getTelemetryContext } from '../src/lib/telemetrySanitizer';
import { seedCurrentTelemetryQueue } from './telemetry/seedCurrentQueue';

function errorQueueItem(id: string, type: string, owner: string, timestamp = Date.now()): QueuedTelemetryItem {
  return {
    id,
    timestamp,
    itemType: 'error',
    payload: {
      id: 'err_' + id,
      timestamp,
      type,
      message: 'Diagnostic ' + id,
      source: 'custom',
      context: getTelemetryContext(),
      userId: owner,
      sessionId: 'sess_m4_retry',
      count: 1,
      firstSeen: timestamp,
      lastSeen: timestamp,
    },
    retryCount: 0,
  };
}

describe('Milestone 4 Challenger: Offline Error Delivery & Retry', () => {
  let mockSentryTransport: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    mockSentryTransport = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);
    telemetryHub.reset();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    telemetryHub.reset();
  });

  it('halts a failed technical-error replay after two consecutive failures and retries in FIFO order', async () => {
    vi.useFakeTimers();
    const owner = 'user_circuit_breaker';
    telemetryHub.init();
    telemetryHub.setUserId(owner);

    const items = Array.from({ length: 20 }, (_, i) =>
      errorQueueItem('item_' + (i + 1), 'TransportError', owner, Date.now() - 2000 + i * 100)
    );
    await seedCurrentTelemetryQueue(owner, items);

    mockSentryTransport
      .mockResolvedValueOnce(true)
      .mockRejectedValue(new Error('Sentry transport unavailable'));

    await telemetryHub.flushQueue();

    expect(mockSentryTransport).toHaveBeenCalledTimes(3);
    expect(mockSentryTransport.mock.calls.every((call: [string]) => call[0] === 'error')).toBe(true);

    const remaining = telemetryHub.getQueuedEvents();
    expect(remaining).toHaveLength(19);
    expect(remaining[0].id).toBe('item_2');
    expect(remaining[0].retryCount).toBe(1);
    expect(remaining[1].id).toBe('item_3');
    expect(remaining[1].retryCount).toBe(1);
    expect(remaining[18].id).toBe('item_20');

    mockSentryTransport.mockReset().mockResolvedValue(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(mockSentryTransport).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => {
      expect(mockSentryTransport).toHaveBeenCalledTimes(19);
      expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
    });

    const replayedIds = mockSentryTransport.mock.calls.map((call: [string, TelemetryErrorPayload]) => call[1].id);
    expect(replayedIds).toEqual(remaining.map(item => 'err_' + item.id));
    expect(mockSentryTransport.mock.calls.every((call: [string]) => call[0] === 'error')).toBe(true);
  });

  it('delivers a valid technical error after a rejected poison item, then evicts only the poison after retry exhaustion', async () => {
    vi.useFakeTimers();
    const owner = 'user_poison_hetero';
    telemetryHub.init();
    telemetryHub.setUserId(owner);
    await seedCurrentTelemetryQueue(owner, [
      errorQueueItem('poison_item', 'PoisonType', owner),
      errorQueueItem('valid_item_after', 'ValidType', owner, Date.now() + 1),
    ]);

    mockSentryTransport.mockImplementation(async (kind: string, payload: TelemetryErrorPayload) => {
      expect(kind).toBe('error');
      return payload.type !== 'PoisonType';
    });

    await telemetryHub.flushQueue();
    let queue = telemetryHub.getQueuedEvents();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('poison_item');
    expect(queue[0].retryCount).toBe(1);
    expect(mockSentryTransport).toHaveBeenCalledTimes(2);
    expect(mockSentryTransport.mock.calls[1][1].type).toBe('ValidType');

    for (const attempt of [2, 3]) {
      await telemetryHub.flushQueue();
      queue = telemetryHub.getQueuedEvents();
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe('poison_item');
      expect(queue[0].retryCount).toBe(attempt);
    }

    await telemetryHub.flushQueue();
    expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
    expect(mockSentryTransport).toHaveBeenCalledTimes(5);
    expect(mockSentryTransport.mock.calls.filter((call: [string, TelemetryErrorPayload]) => call[1].type === 'ValidType')).toHaveLength(1);
  });
});
