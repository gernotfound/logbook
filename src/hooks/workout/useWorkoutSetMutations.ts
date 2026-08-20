import { useCallback } from 'react';
import { Logic } from '../../lib/logic';
import { useAppStore } from '../../store/useAppStore';
import type { WorkoutSession } from '../../types';

interface UseWorkoutSetMutationsProps {
    setLocalWorkout: (updater: (prev: WorkoutSession | null) => WorkoutSession | null) => void;
    showConfirm: (message: string) => Promise<boolean>;
}

export function useWorkoutSetMutations({ setLocalWorkout, showConfirm }: UseWorkoutSetMutationsProps) {
    const addExtraExercise = useCallback((exInput: string | { exId: string }) => {
        const exId = typeof exInput === 'string' ? exInput : exInput?.exId;
        if (!exId) return;
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                exercises: [
                    ...prev.exercises,
                    { id: Logic.generateId('se'), exId, sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }], sessionNote: '' }
                ]
            };
        });
    }, [setLocalWorkout]);

    const addSpecialSet = useCallback((exIndex: number, setId: string, type: string, closePanelsCallback?: () => void) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                return {
                    ...ex,
                    sets: ex.sets.map((s: any) => {
                        if (s.id !== setId) return s;
                        if (type === 'dropset') {
                            return { ...s, dropsets: [...(s.dropsets || []), { id: Logic.generateId('ds'), kg: '', reps: '' }] };
                        } else if (type === 'isometry') {
                            return { ...s, isometrics: [...(s.isometrics || []), { id: Logic.generateId('iso'), kg: '', time: '' }] };
                        }
                        return s;
                    })
                };
            });
            return { ...prev, exercises: updatedExercises };
        });
        if (closePanelsCallback) closePanelsCallback();
    }, [setLocalWorkout]);

    const reorderExercises = useCallback((fromIndex: number, toIndex: number) => {
        setLocalWorkout((prev) => {
            if (!prev || !Array.isArray(prev.exercises)) return prev;
            const total = prev.exercises.length;
            if (fromIndex < 0 || fromIndex >= total || toIndex < 0 || toIndex >= total || fromIndex === toIndex) {
                return prev;
            }
            const newExercises = [...prev.exercises];
            const [removed] = newExercises.splice(fromIndex, 1);
            newExercises.splice(toIndex, 0, removed);
            return { ...prev, exercises: newExercises };
        });
    }, [setLocalWorkout]);

    const moveExercise = useCallback((index: number, direction: 'up' | 'down') => {
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        reorderExercises(index, targetIndex);
    }, [reorderExercises]);

    const removeActiveExercise = useCallback(async (exIndex: number, closePanelsCallback?: (index: number) => void) => {
        if (!(await showConfirm("Rimuovere questo esercizio dalla sessione corrente?"))) return;
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = [...prev.exercises];
            updatedExercises.splice(exIndex, 1);
            return { ...prev, exercises: updatedExercises };
        });
        if (closePanelsCallback) closePanelsCallback(exIndex);
    }, [showConfirm, setLocalWorkout]);

    // Sets Management - Sempre atomici con functional update
    const addSet = useCallback((exIndex: number) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                const newSet: any = { id: Logic.generateId('s'), kg: '', reps: '' };
                if (ex.defaultTechnique === 'dropset') {
                    newSet.dropsets = [{ id: Logic.generateId('ds'), kg: '', reps: '' }];
                } else if (ex.defaultTechnique === 'isometrics') {
                    newSet.isometrics = [{ id: Logic.generateId('iso'), kg: '', time: '' }];
                }
                return { ...ex, sets: [...ex.sets, newSet] };
            });
            return { ...prev, exercises: updatedExercises };
        });
    }, [setLocalWorkout]);

    const removeSet = useCallback((exIndex: number, setIndex: number) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                return { ...ex, sets: ex.sets.filter((_: any, si: number) => si !== setIndex) };
            });
            return { ...prev, exercises: updatedExercises };
        });
    }, [setLocalWorkout]);

    const updateSet = useCallback((exIndex: number, setId: string, field: string, value: any) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                return {
                    ...ex,
                    sets: ex.sets.map((s: any) => s.id === setId ? { ...s, [field]: value } : s)
                };
            });
            return { ...prev, exercises: updatedExercises };
        });
    }, [setLocalWorkout]);

    // Special Sets
    const updateSpecialSet = useCallback((exIndex: number, setId: string, collection: string, specIndex: number, field: string, value: any) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                return {
                    ...ex,
                    sets: ex.sets.map((s: any) => {
                        if (s.id !== setId || !s[collection]) return s;
                        const newColl = s[collection].map((item: any, idx: number) => idx === specIndex ? { ...item, [field]: value } : item);
                        return { ...s, [collection]: newColl };
                    })
                };
            });
            return { ...prev, exercises: updatedExercises };
        });
    }, [setLocalWorkout]);

    const removeSpecialSet = useCallback((exIndex: number, setId: string, collection: string, specIndex: number) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                return {
                    ...ex,
                    sets: ex.sets.map((s: any) => {
                        if (s.id !== setId || !s[collection]) return s;
                        return { ...s, [collection]: s[collection].filter((_: any, idx: number) => idx !== specIndex) };
                    })
                };
            });
            return { ...prev, exercises: updatedExercises };
        });
    }, [setLocalWorkout]);

    const removeLastSet = useCallback(async (exIndex: number) => {
        const currentWorkout = useAppStore.getState().localWorkout;
        const ex = currentWorkout?.exercises?.[exIndex];
        if (!ex || !ex.sets || ex.sets.length === 0) return;

        const setsCount = ex.sets.length;
        const lastSet: any = ex.sets[setsCount - 1];

        const checkVal = (v: any) => {
            if (v === undefined || v === null) return false;
            const s = String(v).trim();
            if (s === '' || s === '0') return false;
            const n = Number(s.replace(',', '.'));
            return isNaN(n) ? true : n !== 0;
        };
        const isFilled =
            checkVal(lastSet.kg) ||
            checkVal(lastSet.weight) ||
            checkVal(lastSet.reps) ||
            checkVal(lastSet.time) ||
            checkVal(lastSet.timeInSeconds) ||
            checkVal(lastSet.distance) ||
            checkVal(lastSet.speed) ||
            checkVal(lastSet.incline) ||
            checkVal(lastSet.kcal) ||
            (Array.isArray(lastSet.dropsets) && lastSet.dropsets.some((ds: any) => checkVal(ds.kg) || checkVal(ds.weight) || checkVal(ds.reps))) ||
            (Array.isArray(lastSet.isometrics) && lastSet.isometrics.some((iso: any) => checkVal(iso.kg) || checkVal(iso.weight) || checkVal(iso.time) || checkVal(iso.timeInSeconds)));

        if (isFilled) {
            const ok = await showConfirm("La serie contiene dei dati. Vuoi davvero rimuoverla?");
            if (!ok) return;
        }

        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((exItem: any, i: number) => {
                if (i !== exIndex) return exItem;
                return { ...exItem, sets: exItem.sets.slice(0, -1) };
            });
            return { ...prev, exercises: updatedExercises };
        });
    }, [setLocalWorkout, showConfirm]);

    const updateSessionNote = useCallback((exIndex: number, note: string) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                return { ...ex, sessionNote: note };
            });
            return { ...prev, exercises: updatedExercises };
        });
    }, [setLocalWorkout]);

    return {
        addExtraExercise,
        addSpecialSet,
        reorderExercises,
        moveExercise,
        removeActiveExercise,
        addSet,
        removeSet,
        removeLastSet,
        updateSet,
        updateSpecialSet,
        removeSpecialSet,
        updateSessionNote
    };
}
