import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTelemetryId } from '../src/lib/telemetry/id';

describe('telemetry identifiers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('prefers Web Crypto UUID entropy while preserving the identifier shape', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
      getRandomValues: vi.fn(),
    });

    expect(createTelemetryId('evt', 123)).toBe('evt_123_123e4567e89b42d3a456426614174000');
  });

  it('remains collision-safe within the runtime without falling back to Math.random', () => {
    vi.stubGlobal('crypto', undefined);
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used for telemetry identifiers');
    });

    const first = createTelemetryId('evt', 123);
    const second = createTelemetryId('evt', 123);

    expect(first).not.toBe(second);
    expect(first).toMatch(/^evt_123_[0-9a-z]+$/);
    expect(second).toMatch(/^evt_123_[0-9a-z]+$/);
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
