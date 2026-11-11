import { StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useScrollLock } from '../../src/hooks/useScrollLock';

function Lock({ enabled = true }: { enabled?: boolean }) {
  useScrollLock(enabled);
  return null;
}

afterEach(() => {
  cleanup();
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('overflow-x');
  document.body.style.removeProperty('overflow-y');
  document.body.style.removeProperty('touch-action');
});

describe('useScrollLock', () => {
  it('restores pre-existing inline styles and priority after the last lock closes', () => {
    document.body.style.setProperty('overflow', 'auto', 'important');
    document.body.style.setProperty('touch-action', 'pan-y');

    const view = render(<><Lock /><Lock /></>);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.touchAction).toBe('none');

    view.rerender(<Lock />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.touchAction).toBe('none');

    view.unmount();
    expect(document.body.style.getPropertyValue('overflow')).toBe('auto');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
    expect(document.body.style.touchAction).toBe('pan-y');
  });

  it('restores inline overflow axes after the shorthand lock is released', () => {
    document.body.style.setProperty('overflow-x', 'auto');
    document.body.style.setProperty('overflow-y', 'scroll', 'important');

    const view = render(<Lock />);
    expect(document.body.style.overflow).toBe('hidden');

    view.unmount();
    expect(document.body.style.getPropertyValue('overflow-x')).toBe('auto');
    expect(document.body.style.getPropertyValue('overflow-y')).toBe('scroll');
    expect(document.body.style.getPropertyPriority('overflow-y')).toBe('important');
  });

  it('does not lock when disabled, and removes its own styles on release', () => {
    const view = render(<Lock enabled={false} />);
    expect(document.body.style.overflow).toBe('');

    view.rerender(<Lock />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.touchAction).toBe('none');

    view.rerender(<Lock enabled={false} />);
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.touchAction).toBe('');
    view.unmount();
  });

  it('balances effect replays in StrictMode', () => {
    const view = render(<StrictMode><Lock /></StrictMode>);
    expect(document.body.style.overflow).toBe('hidden');

    view.unmount();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.touchAction).toBe('');
  });
});
