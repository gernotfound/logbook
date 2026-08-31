import { useEffect, useRef, useCallback } from 'react';
import { computeWeeklyVolumeSeries, computeVolumeCaloriesCorrelation } from '../lib/calc/analytics';
import AnalyticsWorker from '../workers/analytics.worker?worker';

let messageIdCounter = 0;

export function useAnalyticsWorker() {
    const workerRef = useRef<Worker | null>(null);
    const pendingPromises = useRef<Map<number, { resolve: (val: any) => void, reject: (err: any) => void, timeoutId: ReturnType<typeof setTimeout> }>>(new Map());

    useEffect(() => {
        try {
            workerRef.current = new AnalyticsWorker();
            
            workerRef.current.onmessage = (e) => {
                const { id, type, result, error } = e.data;
                const promiseHandlers = pendingPromises.current.get(id);
                if (promiseHandlers) {
                    clearTimeout(promiseHandlers.timeoutId);
                    pendingPromises.current.delete(id);
                    if (type === 'SUCCESS') {
                        promiseHandlers.resolve(result);
                    } else {
                        promiseHandlers.reject(new Error(error || 'Worker error'));
                    }
                }
            };
            
            workerRef.current.onerror = (e) => {
                console.warn("Analytics Worker encountered an error:", e);
                // We don't reject here because the task specific reject logic handles fallbacks.
                // But we need to clean up pending promises and trigger their fallback.
                const pending = Array.from(pendingPromises.current.entries());
                pendingPromises.current.clear();
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
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
            const pending = Array.from(pendingPromises.current.entries());
            pendingPromises.current.clear();
            for (const [, handlers] of pending) {
                clearTimeout(handlers.timeoutId);
                handlers.reject(new Error('Worker terminated on unmount'));
            }
        };
    }, []);

    const executeTask = useCallback(async (type: string, payload: any, fallbackFn: () => any, timeoutMs = 8000) => {
        if (!workerRef.current) {
            console.info(`Worker not available for ${type}, falling back to synchronous execution`);
            const start = performance.now();
            const result = fallbackFn();
            console.info(`Fallback sync for ${type} took ${(performance.now() - start).toFixed(2)}ms`);
            return result;
        }

        return new Promise((resolve, reject) => {
            const id = ++messageIdCounter;
            
            const timeoutId = setTimeout(() => {
                const handlers = pendingPromises.current.get(id);
                if (handlers) {
                    pendingPromises.current.delete(id);
                    console.warn(`Worker task ${type} timed out after ${timeoutMs}ms, falling back to synchronous execution`);
                    try {
                        const start = performance.now();
                        const res = fallbackFn();
                        console.info(`Fallback sync for ${type} after timeout took ${(performance.now() - start).toFixed(2)}ms`);
                        resolve(res);
                    } catch (fallbackErr) {
                        reject(fallbackErr);
                    }
                }
            }, timeoutMs);

            pendingPromises.current.set(id, {
                resolve,
                reject: (err) => {
                    console.warn(`Worker task ${type} failed/rejected, falling back to synchronous execution. Reason:`, err.message);
                    try {
                        const start = performance.now();
                        const res = fallbackFn();
                        console.info(`Fallback sync for ${type} after error took ${(performance.now() - start).toFixed(2)}ms`);
                        resolve(res);
                    } catch (fallbackErr) {
                        reject(fallbackErr);
                    }
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
                    console.warn(`Worker postMessage failed for ${type}, falling back to synchronous execution`, err);
                    try {
                        const start = performance.now();
                        const res = fallbackFn();
                        console.info(`Fallback sync for ${type} after postMessage error took ${(performance.now() - start).toFixed(2)}ms`);
                        resolve(res);
                    } catch (fallbackErr) {
                        reject(fallbackErr);
                    }
                }
            }
        });
    }, []);

    const calculateVolumeStats = useCallback(async (history: any, library: any, userWeight: any, numWeeks: any, referenceDate?: any) => {
        return executeTask(
            'CALCULATE_VOLUME_STATS', 
            { history, library, userWeight, numWeeks, referenceDate },
            () => computeWeeklyVolumeSeries(history, library, userWeight, numWeeks, referenceDate)
        );
    }, [executeTask]);

    const calculateCorrelationStats = useCallback(async (history: any, nutrition: any, library: any, userWeight: any, numWeeks: any, referenceDate?: any) => {
        return executeTask(
            'CALCULATE_CORRELATION_STATS',
            { history, nutrition, library, userWeight, numWeeks, referenceDate },
            () => computeVolumeCaloriesCorrelation(history, nutrition, library, userWeight, numWeeks, referenceDate)
        );
    }, [executeTask]);

    return {
        calculateVolumeStats,
        calculateCorrelationStats
    };
}
