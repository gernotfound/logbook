import { useEffect, useRef, useCallback } from 'react';
import { computeWeeklyVolumeSeries, computeWeeklyVolumeSeriesCooperative, computeVolumeCaloriesCorrelation, computeVolumeCaloriesCorrelationCooperative, computeVolumeCaloriesCorrelationFromVolume } from '../lib/calc/analytics';
import { getLocalDateString } from '../lib/utils/date';
import AnalyticsWorker from '../workers/analytics.worker?worker';

let messageIdCounter = 0;
type VolumeResult = ReturnType<typeof computeWeeklyVolumeSeries>;

// Only in-flight results are shared; no persistent cache may outlive its source data.
const inflightVolumes = new WeakMap<object, WeakMap<object, Map<string, Promise<VolumeResult>>>>();

function volumeRequests(history: unknown, library: unknown): Map<string, Promise<VolumeResult>> | null {
    if (!Array.isArray(history) || !Array.isArray(library)) return null;
    let byLibrary = inflightVolumes.get(history);
    if (!byLibrary) {
        byLibrary = new WeakMap();
        inflightVolumes.set(history, byLibrary);
    }
    let requests = byLibrary.get(library);
    if (!requests) {
        requests = new Map();
        byLibrary.set(library, requests);
    }
    return requests;
}

export function useAnalyticsWorker(enabled = true, latestOnly = false) {
    const workerRef = useRef<Worker | null>(null);
    const mounted = useRef(false);
    // A previous activation must never complete work for a newly activated view.
    const generationRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const requestSerialRef = useRef(0);
    const restartWorkerRef = useRef<() => void>(() => {});
    const pendingPromises = useRef<Map<number, { resolve: (val: any) => void, reject: (err: any) => void, cancel: (err: Error) => void, timeoutId: ReturnType<typeof setTimeout> }>>(new Map());

    useEffect(() => {
        if (!enabled) return;
        mounted.current = true;
        generationRef.current++;
        abortControllerRef.current = new AbortController();
        const pendingForThisMount = pendingPromises.current;
        const initializeWorker = () => {
        try {
            const worker = new AnalyticsWorker();
            workerRef.current = worker;

            worker.onmessage = (e) => {
                const { id, type, result, error } = e.data;
                const promiseHandlers = pendingForThisMount.get(id);
                if (promiseHandlers) {
                    clearTimeout(promiseHandlers.timeoutId);
                    pendingForThisMount.delete(id);
                    if (type === 'SUCCESS') {
                        promiseHandlers.resolve(result);
                    } else {
                        promiseHandlers.reject(new Error(error || 'Worker error'));
                    }
                }
            };
            
            worker.onerror = (e) => {
                // A late event from a terminated generation cannot terminate its successor.
                if (workerRef.current !== worker) return;
                console.warn("Analytics Worker encountered an error:", e);
                // A failed worker is not retried: terminate it and use the established
                // synchronous fallback for current and subsequent requests.
                worker.terminate();
                workerRef.current = null;
                const pending = Array.from(pendingForThisMount.entries());
                pendingForThisMount.clear();
                for (const [, handlers] of pending) {
                    clearTimeout(handlers.timeoutId);
                    handlers.reject(new Error('Worker crashed'));
                }
            };
        } catch (err) {
            console.warn("Failed to initialize Analytics Worker (ad-blocker or unsupported environment):", err);
            workerRef.current = null;
        }
        };
        restartWorkerRef.current = initializeWorker;
        initializeWorker();

        return () => {
            restartWorkerRef.current = () => {};
            mounted.current = false;
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
            const pending = Array.from(pendingForThisMount.entries());
            pendingForThisMount.clear();
            for (const [, handlers] of pending) {
                clearTimeout(handlers.timeoutId);
                handlers.reject(new Error('Worker terminated on unmount'));
            }
        };
    }, [enabled]);

    const beginRequest = useCallback((): number => {
        const serial = ++requestSerialRef.current;
        if (!latestOnly) return serial;
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();
        const pending = Array.from(pendingPromises.current.values());
        if (pending.length > 0) {
            pendingPromises.current.clear();
            workerRef.current?.terminate();
            workerRef.current = null;
            for (const task of pending) {
                clearTimeout(task.timeoutId);
                task.cancel(new Error('Calcolo annullato: richiesta superata'));
            }
            if (mounted.current) restartWorkerRef.current();
        }
        return serial;
    }, [latestOnly]);

    const executeTask = useCallback(async (
        type: string, payload: any, fallbackFn: (signal?: AbortSignal) => any | Promise<any>, timeoutMs: number, serial: number
    ) => {
        if (!mounted.current) throw new Error('Calcolo annullato: vista chiusa');
        const generation = generationRef.current;
        const signal = abortControllerRef.current?.signal;
        const isActiveGeneration = () => mounted.current && generationRef.current === generation
            && (!latestOnly || requestSerialRef.current === serial);
        const runFallback = async () => {
            if (!isActiveGeneration()) throw new Error('Calcolo annullato: vista chiusa');
            const start = performance.now();
            const result = await fallbackFn(signal);
            if (!isActiveGeneration()) throw new Error('Calcolo annullato: vista chiusa');
            console.info(`Analytics fallback for ${type} took ${(performance.now() - start).toFixed(2)}ms`);
            return result;
        };

        if (!workerRef.current) return runFallback();

        return new Promise((resolve, reject) => {
            const id = ++messageIdCounter;
            const timeoutId = setTimeout(() => {
                if (!pendingPromises.current.has(id)) return;
                // Terminate the stalled Worker before scheduling bounded fallback work.
                workerRef.current?.terminate();
                workerRef.current = null;
                const pending = Array.from(pendingPromises.current.values());
                pendingPromises.current.clear();
                console.warn(`Worker task ${type} timed out after ${timeoutMs}ms`);
                for (const task of pending) {
                    clearTimeout(task.timeoutId);
                    task.reject(new Error('Worker timed out'));
                }
            }, timeoutMs);

            pendingPromises.current.set(id, {
                resolve,
                cancel: reject,
                reject: (err) => {
                    if (!mounted.current) { reject(err); return; }
                    console.warn(`Worker task ${type} failed, using fallback:`, err);
                    void runFallback().then(resolve, reject);
                },
                timeoutId
            });
            try {
                workerRef.current!.postMessage({ id, type, payload });
            } catch (err) {
                const handlers = pendingPromises.current.get(id);
                if (handlers) {
                    clearTimeout(handlers.timeoutId);
                    pendingPromises.current.delete(id);
                    handlers.reject(err);
                }
            }
        });
    }, [latestOnly]);

    const calculateVolumeStats = useCallback((history: any, library: any, userWeight: any, numWeeks: any, referenceDate?: any) => {
        const serial = beginRequest();
        const day = referenceDate === undefined ? getLocalDateString() : referenceDate;
        const task: Promise<VolumeResult> = executeTask(
            'CALCULATE_VOLUME_STATS',
            { history, library, userWeight, numWeeks, referenceDate: day },
            signal => Array.isArray(history) && history.length > 512
                ? computeWeeklyVolumeSeriesCooperative(history, library, userWeight, numWeeks, day, signal)
                : computeWeeklyVolumeSeries(history, library, userWeight, numWeeks, day),
            8000, serial,
        );
        if (referenceDate === undefined) {
            const cache = volumeRequests(history, library);
            if (cache) {
                const key = `${userWeight}:${numWeeks}:${day}`;
                cache.set(key, task);
                const clear = () => { if (cache.get(key) === task) cache.delete(key); };
                void task.then(clear, clear);
            }
        }
        return task;
    }, [beginRequest, executeTask]);

    const calculateCorrelationStats = useCallback(async (history: any, nutrition: any, library: any, userWeight: any, numWeeks: any, referenceDate?: any) => {
        const serial = beginRequest();
        const day = referenceDate === undefined ? getLocalDateString() : referenceDate;
        const key = `${userWeight}:${numWeeks}:${day}`;
        const shared = referenceDate === undefined ? volumeRequests(history, library)?.get(key) : undefined;
        if (shared) {
            let volume: VolumeResult | null = null;
            try { volume = await shared; }
            catch { /* The correlation chart must recover independently from a failed volume chart. */ }
            if (!mounted.current || (latestOnly && requestSerialRef.current !== serial)) {
                throw new Error('Calcolo annullato: richiesta superata');
            }
            if (volume) {
                return executeTask(
                    'CALCULATE_CORRELATION_FROM_VOLUME',
                    { volumePoints: volume.points, nutrition, numWeeks, referenceDate: day },
                    () => computeVolumeCaloriesCorrelationFromVolume(volume.points, nutrition, numWeeks, day),
                    8000, serial,
                );
            }
        }
        return executeTask(
            'CALCULATE_CORRELATION_STATS',
            { history, nutrition, library, userWeight, numWeeks, referenceDate: day },
            signal => Array.isArray(history) && history.length > 512
                ? computeVolumeCaloriesCorrelationCooperative(history, nutrition, library, userWeight, numWeeks, day, signal)
                : computeVolumeCaloriesCorrelation(history, nutrition, library, userWeight, numWeeks, day),
            8000, serial,
        );
    }, [beginRequest, executeTask, latestOnly]);

    return {
        calculateVolumeStats,
        calculateCorrelationStats
    };
}
