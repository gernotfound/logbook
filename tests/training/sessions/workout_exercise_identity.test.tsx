import { describe, it, expect, beforeEach } from 'vitest';
import { captureSession } from '../../../src/lib/sync/session';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { persistPlainWorkoutSnapshot } from '../../../src/lib/sync/workoutDeviceIntent';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { useWorkoutSession } from '../../../src/hooks/useWorkoutSession';
import { SessionExerciseSchema } from '../../../src/lib/schema';
import { DeviceWorkoutCorruptError, getInitialLocalWorkout } from '../../../src/store/slices/createWorkoutSlice';
import type { WorkoutSession } from '../../../src/types';
import { installWorkoutReorderFixture } from './workoutReorderFixture';

describe('Workout session identity and device snapshot integrity', () => {
    beforeEach(installWorkoutReorderFixture);

    describe('1. Schema & Data Model: SessionExercise ID Stability', () => {
        it('1.1: SessionExerciseSchema parses and preserves id', () => {
            const raw = {
                id: 'se_12345',
                exId: 'ex_bench',
                sessionNote: 'Note test',
                sets: [{ id: 's_1', kg: '100', reps: '5' }]
            };
            const parsed = SessionExerciseSchema.parse(raw);
            expect(parsed.id).toBe('se_12345');
            expect(parsed.exId).toBe('ex_bench');
        });

        it('1.2: SessionExerciseSchema gracefully handles missing id with undefined', () => {
            const raw = {
                exId: 'ex_bench',
                sessionNote: '',
                sets: []
            };
            const parsed = SessionExerciseSchema.parse(raw);
            expect(parsed.id).toBeUndefined();
            expect(parsed.exId).toBe('ex_bench');
        });

        it('1.3: startWorkout automatically generates stable id (se_...) for each exercise', async () => {
            const owner = captureSession().owner;
            const { result } = renderHook(() => useWorkoutSession());

            await act(async () => {
                await result.current.startWorkout('rot_1');
            });

            const active = useAppStore.getState().localWorkout;
            expect(active).not.toBeNull();
            expect(active?.exercises.length).toBe(2);
            expect(active?.exercises[0].id).toBeDefined();
            expect(active?.exercises[0].id).toMatch(/^se_/);
            expect(active?.exercises[1].id).toBeDefined();
            expect(active?.exercises[1].id).toMatch(/^se_/);
            expect(active?.exercises[0].id).not.toBe(active?.exercises[1].id);
            expect(localStorage.getItem(protectedDeviceKey('workout', owner))).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
        });

        it('1.4: addExtraExercise assigns new unique id (se_...)', async () => {
            const owner = captureSession().owner;
            const initialWorkout: WorkoutSession = {
                id: 'ws_1',
                routineId: 'rot_1',
                routineName: 'Scheda A',
                date: '2026-08-20',
                exercises: [
                    { id: 'se_existing_1', exId: 'ex_bench', sessionNote: '', sets: [] }
                ]
            };
            useAppStore.setState({ localWorkout: initialWorkout });

            const { result } = renderHook(() => useWorkoutSession());

            act(() => {
                result.current.addExtraExercise('ex_pullup');
            });

            const updated = useAppStore.getState().localWorkout;
            expect(updated?.exercises.length).toBe(2);
            expect(updated?.exercises[0].id).toBe('se_existing_1');
            expect(updated?.exercises[1].id).toBeDefined();
            expect(updated?.exercises[1].id).toMatch(/^se_/);
            expect(updated?.exercises[1].id).not.toBe('se_existing_1');
            expect(localStorage.getItem(protectedDeviceKey('workout', owner))).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
        });

        it('1.5: startEditHistoricalWorkout ensures all exercises have id', async () => {
            const owner = captureSession().owner;
            if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
            const historicalWorkout: WorkoutSession = {
                id: 'w_hist_1',
                date: '2026-08-10',
                routineName: 'Storico',
                exercises: [
                    { exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '8' }] }
                ]
            };

            useAppStore.setState(state => ({
                localWorkout: null,
                userData: { ...state.userData!, history: [historicalWorkout], activeWorkout: null },
            }));
            const { result } = renderHook(() => useWorkoutSession());

            await act(async () => {
                await result.current.startEditHistoricalWorkout(historicalWorkout);
            });

            const active = useAppStore.getState().localWorkout;
            expect(active?.isEditingHistory).toBe(true);
            expect(active?.exercises[0].id).toBeDefined();
            expect(active?.exercises[0].id).toMatch(/^se_/);
        });

        it('1.6: preserves malformed authenticated snapshot without generating new persisted identities', async () => {
            const owner = captureSession().owner;
            expect(owner.startsWith('user:')).toBe(true);
            const malformedWorkout = {
                id: 'w_malformed',
                routineName: 'Malformed',
                exercises: [
                    { exId: 'ex_bench', sessionNote: '', sets: [{ kg: '80', reps: '8', rir: 0 }] },
                    { id: 'se_preserved', exId: 'ex_squat', sessionNote: '', sets: [] }
                ]
            };
            expect(() => persistPlainWorkoutSnapshot(malformedWorkout as WorkoutSession, owner))
                .toThrow('identificativo');
            writeDeviceValue('workout', JSON.stringify({
                __logbookWorkoutSnapshot: 1, owner, consentRevision: 1, workout: malformedWorkout,
            }), owner);
            const sealedKey = protectedDeviceKey('workout', owner);
            const originalCiphertext = localStorage.getItem(sealedKey);
            const originalPlain = readDeviceValueStrict('workout', owner);
            expect(originalCiphertext).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();

            expect(() => getInitialLocalWorkout(owner)).toThrow(DeviceWorkoutCorruptError);
            expect(localStorage.getItem(sealedKey)).toBe(originalCiphertext);
            expect(readDeviceValueStrict('workout', owner)).toBe(originalPlain);
            expect(() => persistPlainWorkoutSnapshot(null, owner)).toThrow('identificativi non validi');
            expect(localStorage.getItem(sealedKey)).toBe(originalCiphertext);
        });
    });
});
