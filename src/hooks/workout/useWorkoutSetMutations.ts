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
        const supportedTechniques = ['dropset', 'rest_pause', 'cluster', 'rep_match', 'diminishing', 'isometry'];
        if (!supportedTechniques.includes(type)) return;

        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                return {
                    ...ex,
                    sets: ex.sets.map((s: any, setIndex: number) => {
                        if (s.id !== setId) return s;

                        const previous = setIndex > 0 ? ex.sets[setIndex - 1] : undefined;
                        const previousReps = previous?.reps !== undefined && previous?.reps !== '' ? Number(previous.reps) : NaN;
                        const target = type === 'rep_match' && Number.isFinite(previousReps)
                            ? { type: 'reps', reps: previousReps, sourceSetId: previous.id }
                            : undefined;

                        const legacySegments = [
                            ...(s.dropsets || []).map((ds: any) => ({ id: ds.id || Logic.generateId('seg'), kg: ds.kg ?? '', reps: ds.reps ?? '', technique: 'dropset' })),
                            ...(s.isometrics || []).map((iso: any) => ({ id: iso.id || Logic.generateId('seg'), kg: iso.kg ?? '', reps: '', time: iso.time ?? '', technique: 'isometry' })),
                        ];
                        const existingSegments = Array.isArray(s.segments) && s.segments.length > 0 ? s.segments : legacySegments;
                        const newSegment: any = {
                            id: Logic.generateId('seg'),
                            kg: '',
                            reps: '',
                            technique: type,
                            ...(type === 'isometry' ? { time: '' } : {}),
                            ...(target ? { target } : {}),
                        };
                        const nextSegments = [...existingSegments, newSegment];
                        const primaryTechnique = nextSegments
                            .map((segment: any) => segment.technique ?? s.technique)
                            .find((technique: string | undefined) => technique && technique !== 'straight' && technique !== 'isometry');
                        const { dropsets: _legacyDropsets, isometrics: _legacyIsometrics, technique: _oldTechnique, ...base } = s;
                        return {
                            ...base,
                            ...(primaryTechnique ? { technique: primaryTechnique } : {}),
                            segments: nextSegments,
                        };
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
                    newSet.technique = 'dropset';
                    newSet.segments = [{ id: Logic.generateId('seg'), kg: '', reps: '' }];
                } else if (['rest_pause', 'cluster', 'rep_match', 'diminishing'].includes(ex.defaultTechnique)) {
                    newSet.technique = ex.defaultTechnique;
                    newSet.segments = [{ id: Logic.generateId('seg'), kg: '', reps: '' }];
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
                    sets: ex.sets.map((s: any) => {
                        if (s.id !== setId) return s;
                        if (field === 'rir' && value === undefined) {
                            const { rir: _removedRir, ...withoutRir } = s;
                            return withoutRir;
                        }
                        return { ...s, [field]: value };
                    })
                };
            });
            return { ...prev, exercises: updatedExercises };
        });
    }, [setLocalWorkout]);

    // Special Sets and generalized continuation segments
    const updateSpecialSet = useCallback((exIndex: number, setId: string, collection: string, specIndex: number, field: string, value: any) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                exercises: prev.exercises.map((ex: any, i: number) => i !== exIndex ? ex : ({
                    ...ex,
                    sets: ex.sets.map((s: any) => {
                        if (s.id !== setId || !Array.isArray(s[collection])) return s;
                        return {
                            ...s,
                            [collection]: s[collection].map((item: any, idx: number) => {
                                if (idx !== specIndex) return item;
                                if (value === undefined) {
                                    const { [field]: _removedField, ...withoutField } = item;
                                    return withoutField;
                                }
                                return { ...item, [field]: value };
                            })
                        };
                    })
                }))
            };
        });
    }, [setLocalWorkout]);

    const removeSpecialSet = useCallback((exIndex: number, setId: string, collection: string, specIndex: number) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                exercises: prev.exercises.map((ex: any, i: number) => i !== exIndex ? ex : ({
                    ...ex,
                    sets: ex.sets.map((s: any) => {
                        if (s.id !== setId || !Array.isArray(s[collection])) return s;
                        const next = s[collection].filter((_: any, idx: number) => idx !== specIndex);
                        if (collection === 'segments') {
                            if (next.length === 0) {
                                const { technique: _technique, segments: _segments, target: _target, ...straight } = s;
                                return straight;
                            }
                            const effectiveTechniques = next.map((segment: any) => segment.technique ?? s.technique);
                            const primaryTechnique = effectiveTechniques.find((technique: string | undefined) => technique && technique !== 'straight' && technique !== 'isometry');
                            const keepsRootTarget = effectiveTechniques.some((technique: string | undefined) => technique === 'rep_match' || technique === 'diminishing');
                            const updated = { ...s, segments: next };
                            if (primaryTechnique) updated.technique = primaryTechnique;
                            else delete updated.technique;
                            if (!keepsRootTarget) delete updated.target;
                            return updated;
                        }
                        return { ...s, [collection]: next };
                    })
                }))
            };
        });
    }, [setLocalWorkout]);

    const updateSetTarget = useCallback((exIndex: number, setId: string, reps: number | undefined) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                exercises: prev.exercises.map((ex: any, i: number) => i !== exIndex ? ex : ({
                    ...ex,
                    sets: ex.sets.map((s: any) => {
                        if (s.id !== setId) return s;
                        if (reps === undefined) {
                            const { target: _target, ...withoutTarget } = s;
                            return withoutTarget;
                        }
                        return { ...s, target: { type: 'reps', reps } };
                    })
                }))
            };
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
            lastSet.rir !== undefined ||
            (Array.isArray(lastSet.dropsets) && lastSet.dropsets.some((ds: any) => checkVal(ds.kg) || checkVal(ds.weight) || checkVal(ds.reps))) ||
            (Array.isArray(lastSet.isometrics) && lastSet.isometrics.some((iso: any) => checkVal(iso.kg) || checkVal(iso.weight) || checkVal(iso.time) || checkVal(iso.timeInSeconds))) ||
            (Array.isArray(lastSet.segments) && lastSet.segments.some((segment: any) => checkVal(segment.kg) || checkVal(segment.reps) || checkVal(segment.time) || segment.restBeforeSeconds !== undefined || segment.target !== undefined)) ||
            lastSet.target !== undefined;

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

    const updateTechnicalStandard = useCallback((exIndex: number, value: string) => {
        setLocalWorkout((prev) => {
            if (!prev) return prev;
            const updatedExercises = prev.exercises.map((ex: any, i: number) => {
                if (i !== exIndex) return ex;
                const next = { ...ex };
                if (value.trim()) next.technicalStandard = value;
                else delete next.technicalStandard;
                return next;
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
        updateSetTarget,
        updateSessionNote,
        updateTechnicalStandard
    };
}
