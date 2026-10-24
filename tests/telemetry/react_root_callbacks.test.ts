import { act, Component, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { createReactRootTelemetryOptions } from '../../src/lib/reactRootTelemetry';
import { telemetryHub, type TelemetryErrorPayload } from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSentryTransport } from './telemetryTestHarness';

class DiagnosticBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function FailingChild(): ReactNode {
  throw new Error('React root diagnostic crash');
}

describe('React 19 real root telemetry integration', () => {
  installTelemetryTestHarness();

  it('runs the production caught-error callback from a real React root', async () => {
    telemetryHub.init();
    telemetryHub.setUserId('react-root-caught');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host, createReactRootTelemetryOptions());
    try {
      await act(async () => {
        root.render(createElement(DiagnosticBoundary, null, createElement(FailingChild)));
      });
      await expect.poll(() => mockSentryTransport.mock.calls.length).toBeGreaterThan(0);
      const payloads: TelemetryErrorPayload[] = mockSentryTransport.mock.calls
        .filter((call: any) => call[0] === 'error')
        .map((call: any) => call[1] as TelemetryErrorPayload);
      expect(payloads.some(payload =>
        payload.source === 'react_caught'
        && payload.message === 'React root diagnostic crash'
        && payload.componentStack?.includes('FailingChild')
      )).toBe(true);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it('runs the production uncaught-error callback from a real React root', async () => {
    telemetryHub.init();
    telemetryHub.setUserId('react-root-uncaught');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host, createReactRootTelemetryOptions());
    try {
      // Render outside act(): act() surfaces uncaught root errors directly to
      // the test runner before React completes its normal root error reporting.
      root.render(createElement(FailingChild));
      await expect.poll(() => mockSentryTransport.mock.calls.length).toBeGreaterThan(0);
      const payloads: TelemetryErrorPayload[] = mockSentryTransport.mock.calls
        .filter((call: any) => call[0] === 'error')
        .map((call: any) => call[1] as TelemetryErrorPayload);
      expect(payloads.some(payload =>
        payload.source === 'react_uncaught'
        && payload.message === 'React root diagnostic crash'
        && payload.componentStack?.includes('FailingChild')
      )).toBe(true);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it('maps recoverable root diagnostics through the same production options', async () => {
    telemetryHub.init();
    telemetryHub.setUserId('react-root-recoverable');
    const options = createReactRootTelemetryOptions();
    options.onRecoverableError?.(new Error('Recoverable hydration diagnostic'), {
      componentStack: '\\n    at TestComponent',
    } as Parameters<NonNullable<typeof options.onRecoverableError>>[1]);
    await expect.poll(() => mockSentryTransport.mock.calls.length).toBeGreaterThan(0);
    const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
    expect(payload.source).toBe('react_recoverable');
    expect(payload.message).toBe('Recoverable hydration diagnostic');
    expect(payload.componentStack).toContain('TestComponent');
  });
});
