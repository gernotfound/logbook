import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import { TELEMETRY_DISPATCH_TIMEOUT_MS, type TelemetryErrorPayload, type TelemetryEventPayload } from '../src/lib/telemetry/contracts';
import { dispatchTelemetryError, dispatchTelemetryEvent } from '../src/lib/telemetry/transportRetry';

const OWNER = 'telemetry-timeout-owner';
const errorPayload = { userId: OWNER } as TelemetryErrorPayload;
const eventPayload = { userId: OWNER, details: { phase: 'synthetic' } } as TelemetryEventPayload;

describe('Telemetry dispatch timeout cleanup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('clears the deadline after successful error and event dispatches', async () => {
    const send = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);

    expect(await dispatchTelemetryError(errorPayload, () => OWNER)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    expect(await dispatchTelemetryEvent(eventPayload, () => OWNER)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps the deadline active for a hung request and returns false on timeout', async () => {
    vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockImplementation(() => new Promise<boolean>(() => {}));

    const pending = dispatchTelemetryError(errorPayload, () => OWNER);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(TELEMETRY_DISPATCH_TIMEOUT_MS);
    expect(await pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline when the transport rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockRejectedValueOnce(new Error('Synthetic transport failure'));

    expect(await dispatchTelemetryError(errorPayload, () => OWNER)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start transport or a deadline for a different owner', async () => {
    const send = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);

    expect(await dispatchTelemetryError(errorPayload, () => 'different-owner')).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
