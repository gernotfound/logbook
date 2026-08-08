export const resetGlobalWorkoutTimer = () => {
    try {
        localStorage.removeItem('logbook_timer_state');
        localStorage.removeItem('logbook_timer_start');
        localStorage.removeItem('logbook_timer_accumulated');
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('logbook_reset_timer'));
        }
    } catch (e) {
        console.error("Errore reset timer:", e);
    }
};

export const formatTimerMs = (ms: number) => {
    const elapsed = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
