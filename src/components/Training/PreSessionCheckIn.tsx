import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Logic } from '../../lib/logic';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { readWorkoutRecoveryDraftImage, writeWorkoutRecoveryDraft } from '../../lib/sync/workoutRecoveryDraft';
import { requiredUpdateRecoveryRegistry } from '../../lib/sync/requiredUpdateRecovery';
import { draftRegistry } from '../../lib/utils/draftRegistry';
import type { WorkoutReadiness } from '../../types';

interface PreSessionCheckInProps {
    workoutId: string;
    routineName?: string;
    date?: string;
    onStart: (readiness?: Omit<WorkoutReadiness, 'capturedAt'>) => Promise<boolean>;
    onCancel: () => Promise<boolean>;
}

type ReadinessKey = 'energy' | 'stress' | 'motivation' | 'muscleRecovery';
type ReadinessDraft = Partial<Record<ReadinessKey, number>>;

const METRICS: Array<{ key: ReadinessKey; label: string; low: string; high: string }> = [
    { key: 'energy', label: 'Energia', low: 'Molto bassa', high: 'Molto alta' },
    { key: 'stress', label: 'Stress', low: 'Molto basso', high: 'Molto alto' },
    { key: 'motivation', label: 'Voglia di allenarti', low: 'Nessuna', high: 'Molto alta' },
    { key: 'muscleRecovery', label: 'Recupero muscolare', low: 'Poco recuperato', high: 'Completamente recuperato' },
];

function formatSleep(value: string | number | undefined): string | null {
    const formatted = Logic.formatSleepTime(value);
    if (!formatted) return null;
    const [hours, minutes] = formatted.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (minutes === 0) return `${hours} h`;
    return `${hours} h ${minutes} min`;
}

function parseReadinessDraft(parsed: unknown | null): ReadinessDraft {
    if (parsed === null) return {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Bozza check-in locale non valida.');
    }
    const result: ReadinessDraft = {};
    for (const key of ['energy', 'stress', 'motivation', 'muscleRecovery'] as const) {
        const value = (parsed as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
            throw new Error('Bozza check-in locale corrotta.');
        }
        result[key] = value;
    }
    return result;
}

function blockReadinessPersistence(error: unknown, original?: ReturnType<typeof captureSession> | null): void {
    if (original && !isCurrentSession(original)) {
        let current: ReturnType<typeof captureSession>;
        try { current = captureSession(); }
        catch { return; }
        // A revoked consent in the same owner's mounted editor must still
        // block edits; a previous Auth epoch must not fence an unrelated session.
        if (current.owner !== original.owner || current.epoch !== original.epoch
            || current.guestSessionId !== original.guestSessionId
            || (current.consentMarker === original.consentMarker
                && current.consentGeneration === original.consentGeneration)) return;
    }
    console.error('Persistenza check-in pre-sessione non disponibile:', error);
    useAppStore.setState({
        localPersistenceBlocked: true,
        syncHealth: 'failed',
        syncPresentation: 'normal',
        saveError: 'Bozza del check-in non salvata sul dispositivo. Le modifiche sono bloccate finché lo storage non torna disponibile.',
    });
}

type InitialReadinessRecovery = {
    session: ReturnType<typeof captureSession> | null;
    recoveryName: string;
    recovered: ReadinessDraft;
    raw: string | null;
    error: unknown | null;
};

function createInitialReadinessRecovery(workoutId: string): InitialReadinessRecovery {
    const recoveryName = 'draft:pre-session:' + workoutId;
    try {
        const session = captureSession();
        const image = readWorkoutRecoveryDraftImage(recoveryName, session.owner);
        return {
            session,
            recoveryName,
            recovered: parseReadinessDraft(image.value),
            raw: image.raw,
            error: null,
        };
    } catch (error) {
        return { session: null, recoveryName, recovered: {}, raw: null, error };
    }
}

export default function PreSessionCheckIn({ workoutId, routineName, date, onStart, onCancel }: PreSessionCheckInProps) {
    const nutrition = useAppStore(state => state.userData?.nutrition);
    const activePains = useAppStore(state => state.userData?.activePains || []);
    const [initialRecovery] = useState(() => createInitialReadinessRecovery(workoutId));
    const session = useRef(initialRecovery.session);
    const recoveryName = useRef(initialRecovery.recoveryName);
    const recoveryRaw = useRef(initialRecovery.raw);
    const [values, setValues] = useState<ReadinessDraft>(initialRecovery.recovered);
    const valuesRef = useRef<ReadinessDraft>(initialRecovery.recovered);
    // Recovered and synchronously acknowledged responses are already durable.
    const dirtyRef = useRef(false);
    const [starting, setStarting] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    // Start and deletion target the same prepared workout, even before React rerenders.
    const actionInFlight = useRef(false);
    const sessionDate = date || Logic.getLocalDateString();

    useEffect(() => {
        if (initialRecovery.error) blockReadinessPersistence(initialRecovery.error, initialRecovery.session);
    }, [initialRecovery.error, initialRecovery.session]);

    const persistDraft = useCallback(() => {
        const activeSession = session.current;
        if (!activeSession || !isCurrentSession(activeSession)) throw new Error('Sessione cambiata prima del salvataggio del check-in.');
        if (readWorkoutRecoveryDraftImage(recoveryName.current, activeSession.owner).raw !== recoveryRaw.current) {
            throw new Error('Bozza check-in modificata durante il recupero: originale preservato.');
        }
        if (!dirtyRef.current) return;
        recoveryRaw.current = writeWorkoutRecoveryDraft(
            recoveryName.current, activeSession.owner, valuesRef.current,
            activeSession.consentGeneration, recoveryRaw.current,
        );
        dirtyRef.current = false;
    }, []);

    const clearDraft = useCallback(() => {
        const activeSession = session.current;
        if (!activeSession || !isCurrentSession(activeSession)) throw new Error('Sessione cambiata prima della pulizia del check-in.');
        recoveryRaw.current = writeWorkoutRecoveryDraft(
            recoveryName.current, activeSession.owner, null,
            activeSession.consentGeneration, recoveryRaw.current,
        );
        dirtyRef.current = false;
    }, []);

    useEffect(() => {
        draftRegistry.register(persistDraft);
        const unregisterRecovery = requiredUpdateRecoveryRegistry.register(persistDraft);
        return () => {
            unregisterRecovery();
            draftRegistry.unregister(persistDraft);
        };
    }, [persistDraft]);

    const setMetric = (key: ReadinessKey, value: number) => {
        if (actionInFlight.current) return;
        const current = valuesRef.current;
        const next = { ...current, [key]: current[key] === value ? undefined : value };
        try {
            const activeSession = session.current;
            if (!activeSession || !isCurrentSession(activeSession)) throw new Error('Sessione cambiata prima del salvataggio del check-in.');
            recoveryRaw.current = writeWorkoutRecoveryDraft(
                recoveryName.current, activeSession.owner, next,
                activeSession.consentGeneration, recoveryRaw.current,
            );
        } catch (error) {
            blockReadinessPersistence(error, session.current);
            return;
        }
        valuesRef.current = next;
        dirtyRef.current = false;
        setValues(next);
    };

    const start = async (includeReadiness: boolean) => {
        if (actionInFlight.current) return;
        actionInFlight.current = true;
        setStarting(true);
        try {
            const activeSession = session.current;
            if (!activeSession || !isCurrentSession(activeSession)) throw new Error('Sessione cambiata prima di avviare il workout.');
            // Mounted UI values may predate a consent change in another tab.
            if (readWorkoutRecoveryDraftImage(recoveryName.current, activeSession.owner).raw !== recoveryRaw.current) {
                throw new Error('Check-in modificato da un’altra scheda: avvio bloccato.');
            }
            const started = await onStart(includeReadiness ? valuesRef.current : undefined);
            if (started) {
                try {
                    clearDraft();
                } catch (error) {
                    // The workout is already durable. A failed obsolete-draft cleanup
                    // must not turn a successful start into an unhandled rejection.
                    if (session.current && isCurrentSession(session.current)) {
                        console.warn('Check-in avviato, impossibile pulire la vecchia bozza:', error);
                        useAppStore.getState().setSaveError('Allenamento avviato; impossibile rimuovere una vecchia bozza locale.');
                    }
                }
            }
        } catch (error) {
            blockReadinessPersistence(error, session.current);
        } finally {
            actionInFlight.current = false;
            setStarting(false);
        }
    };

    const cancel = async () => {
        if (actionInFlight.current) return;
        actionInFlight.current = true;
        setCancelling(true);
        try {
            const activeSession = session.current;
            if (!activeSession || !isCurrentSession(activeSession)) throw new Error('Sessione cambiata prima di eliminare il workout.');
            if (readWorkoutRecoveryDraftImage(recoveryName.current, activeSession.owner).raw !== recoveryRaw.current) {
                throw new Error('Check-in modificato da un’altra scheda: cancellazione bloccata.');
            }
            if (await onCancel()) clearDraft();
        } catch (error) {
            blockReadinessPersistence(error, session.current);
        } finally {
            actionInFlight.current = false;
            setCancelling(false);
        }
    };

    return <WorkoutReadinessForm routineName={routineName} sleepHours={nutrition?.[sessionDate]?.sleepHours}
        activePains={activePains} values={values} starting={starting} cancelling={cancelling}
        setMetric={setMetric} start={start} cancel={cancel} />;
}

export function WorkoutReadinessForm({
    routineName, sleepHours, activePains, values, starting, cancelling, setMetric, start, cancel,
}: {
    routineName?: string;
    sleepHours?: number | string;
    activePains: string[];
    values: ReadinessDraft;
    starting: boolean;
    cancelling: boolean;
    setMetric: (key: ReadinessKey, value: number) => void;
    start: (withReadiness: boolean) => Promise<void>;
    cancel: () => Promise<void>;
}) {
    const sleep = formatSleep(sleepHours);
    const painNames = activePains.map(id => Logic.getMuscleName(id) || id);
    return (
        <section className="pre-session-checkin" aria-labelledby="pre-session-title">
            <div className="pre-session-heading">
                <span className="text-sm text-muted">Prima di iniziare</span>
                <h2 id="pre-session-title">Come arrivi oggi?</h2>
                <p>{routineName || 'Allenamento libero'} · Tutti i valori sono facoltativi.</p>
            </div>

            <div className="pre-session-context" aria-label="Contesto pre-sessione">
                <div><strong>Sonno</strong><span>{sleep ? `Registrato: ${sleep}` : 'Non registrato'}</span></div>
                <div><strong>Dolori attivi</strong><span>{painNames.length ? painNames.join(', ') : 'Nessuno registrato'}</span></div>
            </div>

            <div className="pre-session-metrics">
                {METRICS.map(metric => (
                    <fieldset className="readiness-metric" key={metric.key}>
                        <legend>{metric.label}</legend>
                        <div className="readiness-scale" role="group" aria-label={`${metric.label}, scala da 1 a 5`}>
                            {[1, 2, 3, 4, 5].map(value => (
                                <button
                                    key={value}
                                    type="button"
                                    className="readiness-value"
                                    aria-pressed={values[metric.key] === value}
                                    aria-label={`${metric.label}: ${value} su 5`}
                                    disabled={starting || cancelling}
                                    onClick={() => setMetric(metric.key, value)}
                                >
                                    {value}
                                </button>
                            ))}
                        </div>
                        <div className="readiness-scale-hints" aria-hidden="true"><span>{metric.low}</span><span>{metric.high}</span></div>
                    </fieldset>
                ))}
            </div>

            <div className="pre-session-actions">
                <div className="pre-session-primary-actions">
                    <button type="button" className="btn btn-primary" disabled={starting || cancelling} onClick={() => void start(true)}>{starting ? 'Avvio…' : 'Inizia allenamento'}</button>
                    <button type="button" className="btn btn-danger" disabled={starting || cancelling} onClick={() => void cancel()}>{cancelling ? 'Annullamento…' : 'Annulla allenamento'}</button>
                </div>
                <button type="button" className="btn btn-secondary" disabled={starting || cancelling} onClick={() => void start(false)}>Salta check-in e inizia</button>
            </div>
        </section>
    );
}
