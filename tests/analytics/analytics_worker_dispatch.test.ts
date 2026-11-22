import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise, WorkoutSession } from '../../src/types';

const workerScope: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
} = {
    postMessage: vi.fn(),
    onmessage: null,
};

const library: Exercise[] = [{
    id: 'bench',
    name: 'Panca',
    setsCount: 1,
    sets: [],
}];
const history: WorkoutSession[] = [{
    id: 'workout-1',
    date: '2026-08-18',
    exercises: [{
        exId: 'bench',
        sessionNote: '',
        sets: [{ id: 'set-1', kg: '80', reps: '10', done: true }],
    }],
}];
const volumePayload = { history, library, userWeight: 80, numWeeks: 4, referenceDate: '2026-08-22' };

function send(data: unknown) {
    if (!workerScope.onmessage) throw new Error('Worker message handler not registered');
    workerScope.onmessage({ data } as MessageEvent);
    return workerScope.postMessage.mock.lastCall?.[0];
}

beforeAll(async () => {
    vi.stubGlobal('self', workerScope);
    await import('../../src/workers/analytics.worker');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => workerScope.postMessage.mockClear());
afterEach(() => vi.restoreAllMocks());

describe('real analytics worker message boundary', () => {
    it('returns a calculated workout volume under the original request id', () => {
        const reply = send({ id: 101, type: 'CALCULATE_VOLUME_STATS', payload: volumePayload });
        expect(workerScope.postMessage).toHaveBeenCalledTimes(1);
        expect(reply).toMatchObject({
            id: 101,
            type: 'SUCCESS',
            result: { stats: { totalVolumeKg: 800, totalWorkouts: 1 } },
        });
        expect(reply.result.points).toHaveLength(4);
        expect(reply.result.points.at(-1).volumeKg).toBe(800);
    });

    it('calculates correlation directly from history when no volume series was shared', () => {
        const reply = send({
            id: 102,
            type: 'CALCULATE_CORRELATION_STATS',
            payload: { ...volumePayload, nutrition: {} },
        });
        expect(workerScope.postMessage).toHaveBeenCalledTimes(1);
        expect(reply).toMatchObject({
            id: 102,
            type: 'SUCCESS',
            result: { stats: { avgWeeklyVolumeKg: 200, validDataPointsCount: 0 } },
        });
        expect(reply.result.points.at(-1).volumeKg).toBe(800);
    });

    it('reuses supplied volume points for correlation without requiring workout history', () => {
        const volumePoints = [{
            weekIndex: 0,
            weekStart: '2026-08-17',
            weekEnd: '2026-08-23',
            label: '17 ago',
            volumeKg: 1234,
            volumeTon: 1.23,
            workoutCount: 1,
            sessionIds: ['external-1'],
        }];
        const reply = send({
            id: 103,
            type: 'CALCULATE_CORRELATION_FROM_VOLUME',
            payload: { volumePoints, nutrition: {}, numWeeks: 1, referenceDate: '2026-08-22' },
        });
        expect(workerScope.postMessage).toHaveBeenCalledTimes(1);
        expect(reply).toMatchObject({
            id: 103,
            type: 'SUCCESS',
            result: { stats: { avgWeeklyVolumeKg: 1234, validDataPointsCount: 0 } },
        });
        expect(reply.result.points).toHaveLength(1);
        expect(reply.result.points[0].volumeKg).toBe(1234);
    });

    it('rejects an unknown task without publishing an invented success', () => {
        const reply = send({ id: 104, type: 'UNKNOWN_TASK', payload: {} });
        expect(reply).toEqual({ id: 104, type: 'ERROR', error: 'Unknown task type: UNKNOWN_TASK' });
        expect(workerScope.postMessage).toHaveBeenCalledTimes(1);
    });

    it('handles malformed messages without throwing outside its error boundary or losing later requests', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => send(null)).not.toThrow();
        expect(workerScope.postMessage).toHaveBeenCalledTimes(1);
        expect(workerScope.postMessage.mock.lastCall?.[0]).toMatchObject({ type: 'ERROR' });
        expect(consoleError).toHaveBeenCalledTimes(1);

        workerScope.postMessage.mockClear();
        const reply = send({ id: 105, type: 'CALCULATE_VOLUME_STATS', payload: volumePayload });
        expect(reply).toMatchObject({ id: 105, type: 'SUCCESS' });
        expect(workerScope.postMessage).toHaveBeenCalledTimes(1);
    });
});
