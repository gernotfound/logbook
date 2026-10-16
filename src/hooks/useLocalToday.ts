import { useSyncExternalStore } from 'react';
import { Logic } from '../lib/logic';

let currentToday = Logic.getLocalDateString();
const listeners = new Set<() => void>();
let midnightTimer: ReturnType<typeof setTimeout> | undefined;

function refreshToday() {
    const nextToday = Logic.getLocalDateString();
    if (nextToday !== currentToday) {
        currentToday = nextToday;
        listeners.forEach(listener => listener());
    }
    if (midnightTimer !== undefined) clearTimeout(midnightTimer);
    if (listeners.size === 0) {
        midnightTimer = undefined;
        return;
    }
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnightTimer = setTimeout(refreshToday, Math.max(50, midnight.getTime() - now.getTime() + 50));
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
        document.addEventListener('visibilitychange', refreshToday);
        window.addEventListener('focus', refreshToday);
    }
    refreshToday();
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            document.removeEventListener('visibilitychange', refreshToday);
            window.removeEventListener('focus', refreshToday);
            if (midnightTimer !== undefined) clearTimeout(midnightTimer);
            midnightTimer = undefined;
        }
    };
}

export function useLocalToday(): string {
    return useSyncExternalStore(subscribe, () => currentToday, () => currentToday);
}
