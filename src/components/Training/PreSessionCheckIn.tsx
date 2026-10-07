import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Logic } from '../../lib/logic';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { readDeviceValueStrict, writeDeviceValue } from '../../lib/sync/deviceStorage';
import { requiredUpdateRecoveryRegistry } from '../../lib/sync/requiredUpdateRecovery';
import { draftRegistry } from '../../lib/utils/draftRegistry';
import type { WorkoutReadiness } from '../../types';

interface PreSessionCheckInProps {
    workoutId: string;
    routineName?: string;
    date?: string;
    onStart: (readiness?: Omit<WorkoutReadiness, 'capturedAt'>) => Promise<boolean>;
    onCancel: () => Promise<void>;
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

function parseReadinessDraft(raw: string | null): ReadinessDraft {
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
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

function blockReadinessPersistence(error: unknown): void {
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
    error: unknown | null;
};

function createInitialReadinessRecovery(workoutId: string): InitialReadinessRecovery {
    const recoveryName = 'draft:pre-session:' + workoutId;
    try {
        const session = captureSession();
        return {
            session,
            recoveryName,
            recovered: parseReadinessDraft(readDeviceValueStrict(recoveryName, session.owner)),
            error: null,
        };
    } catch (error) {
        return { session: null, recoveryName, recovered: {}, error };
    }
}

export default function PreSessionCheckIn({ workoutId, routineName, date, onStart, onCancel }: PreSessionCheckInProps) {
    const nutrition = useAppStore(state => state.userData?.nutrition);
    const activePains = useAppStore(state => state.userData?.activePains || []);
    const [initialRecovery] = useState(() => createInitialReadinessRecovery(workoutId));
    const session = useRef(initialRecovery.session);
    const recoveryName = useRef(initialRecovery.recoveryName);
    const [values, setValues] = useState<ReadinessDraft>(initialRecovery.recovered);
    const valuesRef = useRef<ReadinessDraft>(initialRecovery.recovered);
    const dirtyRef = useRef(Object.keys(initialRecovery.recovered).length > 0);
    const [starting, setStarting] = useState(false);
    const sessionDate = date || Logic.getLocalDateString();
    const sleep = formatSleep(nutrition?.[sessionDate]?.sleepHours);
    const painNames = useMemo(() => activePains.map(id => Logic.getMuscleName(id) || id), [activePains]);

    useEffect(() => {
        if (initialRecovery.error) blockReadinessPersistence(initialRecovery.error);
    }, [initialRecovery.error]);

    const persistDraft = useCallback(() => {
        if (!dirtyRef.current) return;
        const activeSession = session.current;
        if (!activeSession || !isCurrentSession(activeSession)) throw new Error('Sessione cambiata prima del salvataggio del check-in.');
        writeDeviceValue(recoveryName.current, JSON.stringify(valuesRef.current), activeSession.owner);
    }, []);

    const clearDraft = useCallback(() => {
        const activeSession = session.current;
        if (!activeSession || !isCurrentSession(activeSession)) throw new Error('Sessione cambiata prima della pulizia del check-in.');
        writeDeviceValue(recoveryName.current, null, activeSession.owner);
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
        const current = valuesRef.current;
        const next = { ...current, [key]: current[key] === value ? undefined : value };
        valuesRef.current = next;
        dirtyRef.current = true;
        setValues(next);
        try {
            persistDraft();
        } catch (error) {
            blockReadinessPersistence(error);
        }
    };

    const start = async (includeReadiness: boolean) => {
        if (starting) return;
        setStarting(true);
        try {
            const started = await onStart(includeReadiness ? valuesRef.current : undefined);
            if (started) clearDraft();
        } finally {
            setStarting(false);
        }
    };

    const cancel = async () => {
        if (starting) return;
        await onCancel();
        clearDraft();
    };

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
                    <button type="button" className="btn btn-primary" disabled={starting} onClick={() => void start(true)}>{starting ? 'Avvio…' : 'Inizia allenamento'}</button>
                    <button type="button" className="btn btn-danger" disabled={starting} onClick={() => void cancel()}>Annulla allenamento</button>
                </div>
                <button type="button" className="btn btn-secondary" disabled={starting} onClick={() => void start(false)}>Salta check-in e inizia</button>
            </div>
        </section>
    );
}
