import { useEffect, useRef, useCallback } from 'react';
import { computeWeeklyVolumeSeries, computeWeeklyVolumeSeriesCooperative, computeVolumeCaloriesCorrelation, computeVolumeCaloriesCorrelationCooperative } from '../lib/calc/analytics';
import AnalyticsWorker from '../workers/analytics.worker?worker';

let messageIdCounter = 0;

export function useAnalyticsWorker(enabled = true) {
    const workerRef = useRef<Worker | null>(null);
    const mounted = useRef(false);
    // A previous activation must never complete work for a newly activated view.
    const generationRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingPromises = useRef<Map<number, { resolve: (val: any) => void, reject: (err: any) => void, timeoutId: ReturnType<typeof setTimeout> }>>(new Map());

    useEffect(() => {
        if (!enabled) return;
        mounted.current = true;
        generationRef.current++;
        abortControllerRef.current = new AbortController();
        const pendingForThisMount = pendingPromises.current;
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

        return () => {
            mounted.current = false;
            generationRef.current++;
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

    const executeTask = useCallback(async (
        type: string, payload: any, fallbackFn: () => any | Promise<any>, timeoutMs = 8000
    ) => {
        if (!mounted.current) throw new Error('Calcolo annullato: vista chiusa');
        const generation = generationRef.current;
        const isActiveGeneration = () => mounted.current && generationRef.current === generation;
        const runFallback = async () => {
            if (!isActiveGeneration()) throw new Error('Calcolo annullato: vista chiusa');
            const start = performance.now();
            const result = await fallbackFn();
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
    }, []);

    const calculateVolumeStats = useCallback(async (history: any, library: any, userWeight: any, numWeeks: any, referenceDate?: any) => {
        return executeTask(
            'CALCULATE_VOLUME_STATS', 
            { history, library, userWeight, numWeeks, referenceDate },
            () => Array.isArray(history) && history.length > 512
                ? computeWeeklyVolumeSeriesCooperative(history, library, userWeight, numWeeks, referenceDate, abortControllerRef.current?.signal)
                : computeWeeklyVolumeSeries(history, library, userWeight, numWeeks, referenceDate)
        );
    }, [executeTask]);

    const calculateCorrelationStats = useCallback(async (history: any, nutrition: any, library: any, userWeight: any, numWeeks: any, referenceDate?: any) => {
        return executeTask(
            'CALCULATE_CORRELATION_STATS',
            { history, nutrition, library, userWeight, numWeeks, referenceDate },
            () => Array.isArray(history) && history.length > 512
                ? computeVolumeCaloriesCorrelationCooperative(history, nutrition, library, userWeight, numWeeks, referenceDate, abortControllerRef.current?.signal)
                : computeVolumeCaloriesCorrelation(history, nutrition, library, userWeight, numWeeks, referenceDate)
        );
    }, [executeTask]);

    return {
        calculateVolumeStats,
        calculateCorrelationStats
    };
}
