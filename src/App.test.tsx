import { act, render, waitFor } from '@testing-library/react';
import App from './App';
import { LOCAL_STORAGE_ACTIVE_TAB } from './constants';
import { expect, test } from 'vitest';

test('renders App without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeTruthy();
});

test('app:navigate uses current state across sequential navigation events', async () => {
    render(<App />);

    act(() => {
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'training' }));
    });
    await waitFor(() => expect(localStorage.getItem(LOCAL_STORAGE_ACTIVE_TAB)).toBe('"training"'));

    act(() => {
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'nutrition' }));
    });
    await waitFor(() => expect(localStorage.getItem(LOCAL_STORAGE_ACTIVE_TAB)).toBe('"nutrition"'));

    act(() => {
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'home' }));
    });
    await waitFor(() => expect(localStorage.getItem(LOCAL_STORAGE_ACTIVE_TAB)).toBe('"home"'));
});
