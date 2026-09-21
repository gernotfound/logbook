import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SubNav from '../src/components/UI/SubNav';

const items = [{ id: 'session', label: 'Sessione' }, { id: 'planning', label: 'Pianificazione' }, { id: 'history', label: 'Storico' }] as const;
function Example() {
  const [value, setValue] = useState<'session' | 'planning' | 'history'>('session');
  return <SubNav id="test" label="Allenamento" items={items} value={value} onChange={setValue} />;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('sub-navigation interaction', () => {
  it('uses one tab stop, arrow wrap, Home and End, and keeps panel relationships', () => {
    render(<Example />);
    const session = screen.getByRole('tab', { name: 'Sessione' });
    const planning = screen.getByRole('tab', { name: 'Pianificazione' });
    const history = screen.getByRole('tab', { name: 'Storico' });
    session.focus();
    fireEvent.keyDown(session, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(planning);
    expect(planning.getAttribute('aria-selected')).toBe('true');
    expect(planning.getAttribute('aria-controls')).toBe('test-panel-planning');
    expect(session.tabIndex).toBe(-1);
    fireEvent.keyDown(planning, { key: 'End' });
    expect(document.activeElement).toBe(history);
    fireEvent.keyDown(history, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(session);
    fireEvent.keyDown(session, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(history);
    fireEvent.keyDown(history, { key: 'Home' });
    expect(document.activeElement).toBe(session);
    expect(screen.getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toEqual([session]);
  });

  it('reveals a retained selection on resize or reappearance without scrolling the page', () => {
    let resized: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const { unmount } = render(<SubNav id="test" label="Allenamento" items={items} value="history" onChange={vi.fn()} />);
    const list = screen.getByRole('tablist');
    const history = screen.getByRole('tab', { name: 'Storico' });
    // Geometry here tests only scroll ownership; real viewport layout is covered by E2E.
    let width = 0;
    Object.defineProperty(list, 'clientWidth', { get: () => width });
    Object.defineProperty(list, 'scrollWidth', { value: 480 });
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, right: width } as DOMRect));
    vi.spyOn(history, 'getBoundingClientRect').mockImplementation(() => ({ left: 380 - list.scrollLeft, right: 480 - list.scrollLeft } as DOMRect));
    const scrollPage = vi.spyOn(window, 'scrollTo');
    scrollPage.mockClear();
    act(() => resized());
    expect(list.scrollLeft).toBe(0);
    width = 320;
    act(() => resized());
    expect(list.scrollLeft).toBe(160);
    width = 250;
    fireEvent(window, new Event('resize'));
    expect(list.scrollLeft).toBe(230);
    expect(scrollPage).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
