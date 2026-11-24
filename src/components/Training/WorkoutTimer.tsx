import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useAppStore } from '../../store/useAppStore';
import { WorkoutTimerControls } from './WorkoutTimerControls';
import {
    readWorkoutTimerSnapshot,
    stoppedWorkoutTimer,
    writeWorkoutTimerSnapshot,
    type WorkoutTimerSnapshot,
} from '../../lib/utils/timer';

const sameTimerSnapshot = (a: WorkoutTimerSnapshot, b: WorkoutTimerSnapshot): boolean =>
    a.version === b.version && a.state === b.state
    && a.startTime === b.startTime && a.accumulated === b.accumulated;

export default function WorkoutTimer({ isActive = true }: { isActive?: boolean } = {}) {
    const { currentUser, isGuest } = useAuth();
    const owner = !isGuest && currentUser ? `user:${currentUser.uid}` : 'guest';
    return <OwnerWorkoutTimer key={owner} owner={owner} isActive={isActive} />;
}

function OwnerWorkoutTimer({ owner, isActive }: { owner: string; isActive: boolean }) {
    const [initialTimer] = useState(() => {
        try {
            return { snapshot: readWorkoutTimerSnapshot(owner), unreadable: false, error: null };
        } catch (error) {
            return { snapshot: stoppedWorkoutTimer(), unreadable: true, error };
        }
    });
    const [restTimer, setRestTimer] = useState<WorkoutTimerSnapshot>(initialTimer.snapshot);
    const [timerUnreadable, setTimerUnreadable] = useState(initialTimer.unreadable);
    const [timerConflict, setTimerConflict] = useState(false);

    useEffect(() => {
        if (!initialTimer.unreadable) return;
        console.error('Timer device-critical non leggibile:', initialTimer.error);
        useAppStore.setState({
            localPersistenceBlocked: true,
            syncHealth: 'failed',
            syncPresentation: 'normal',
            saveError: 'Timer locale non leggibile. Riapri TheLogBook prima di usare o sovrascrivere il cronometro.',
        });
    }, [initialTimer]);

    const commitTimer = (next: WorkoutTimerSnapshot): boolean => {
        if (timerUnreadable) return false;
        try {
            // A second tab can replace the timer while this UI is mounted.
            // Refuse to overwrite a newer snapshot with an action based on stale state.
            const current = readWorkoutTimerSnapshot(owner);
            if (!sameTimerSnapshot(current, restTimer)) {
                setRestTimer(current);
                setTimerConflict(true);
                return false;
            }
            // Device-critical timer transitions are persisted synchronously before
            // the UI confirms them. A failed write therefore cannot look saved.
            writeWorkoutTimerSnapshot(next, owner);
            setRestTimer(next);
            setTimerConflict(false);
            return true;
        } catch (error) {
            console.error('Persistenza timer device-critical fallita:', error);
            setTimerUnreadable(true);
            useAppStore.setState({
                localPersistenceBlocked: true,
                syncHealth: 'failed',
                syncPresentation: 'normal',
                saveError: 'Impossibile salvare il timer su questo dispositivo. Riapri TheLogBook prima di continuare.',
            });
            return false;
        }
    };

    useEffect(() => {
        const handleReset = (event: Event) => {
            // A reset for a different owner must not alter this owner's rendered timer.
            if (!(event instanceof CustomEvent) || event.detail?.owner !== owner) return;
            // resetGlobalWorkoutTimer publishes the owner only after its write succeeds.
            setRestTimer(stoppedWorkoutTimer());
            setTimerConflict(false);
        };
        window.addEventListener('logbook_reset_timer', handleReset);
        return () => window.removeEventListener('logbook_reset_timer', handleReset);
    }, [owner]);

    return <WorkoutTimerControls snapshot={restTimer} isActive={isActive}
        timerUnreadable={timerUnreadable} timerConflict={timerConflict} onChange={commitTimer} />;
}
