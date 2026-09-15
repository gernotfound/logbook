import fs from 'node:fs';

function replaceOne(path, from, to) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected exactly one match, found ${count}`);
  fs.writeFileSync(path, source.replace(from, to), 'utf8');
}

replaceOne(
  'src/hooks/useHomeView.ts',
  `    const saveUserData = useAppStore(state => state.saveUserData);`,
  `    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);`,
);
replaceOne(
  'src/hooks/useHomeView.ts',
  `    const toggleActivePain = useCallback((muscleId: string) => {\n        if (!muscleId || typeof muscleId !== 'string') return;\n        saveUserData(prev => {\n            if (!prev) return prev;\n            const currentPains = Array.isArray(prev.activePains) ? prev.activePains : [];\n            const nextPains = currentPains.includes(muscleId)\n                ? currentPains.filter(p => p !== muscleId)\n                : [...currentPains, muscleId];\n            return {\n                ...prev,\n                activePains: nextPains\n            };\n        });\n    }, [saveUserData]);`,
  `    const toggleActivePain = useCallback((muscleId: string) => {\n        if (!muscleId || typeof muscleId !== 'string') return;\n        const nextPains = activePains.includes(muscleId)\n            ? activePains.filter(p => p !== muscleId)\n            : [...activePains, muscleId];\n        void dispatchDomainOperation({ type: 'active-pains.set', pains: nextPains });\n    }, [activePains, dispatchDomainOperation]);`,
);

replaceOne(
  'src/hooks/useTrainingExercises.ts',
  `    const saveUserData = useAppStore(state => state.saveUserData);`,
  `    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);`,
);
replaceOne(
  'src/hooks/useTrainingExercises.ts',
  `            await saveUserData((prev) => {\n                if (!prev) return null;\n                return {\n                    ...prev,\n                    library: [...(prev.library || []), duplicated]\n                };\n            });`,
  `            await dispatchDomainOperation({ type: 'exercise.upsert', exercise: duplicated });`,
);
replaceOne(
  'src/hooks/useTrainingExercises.ts',
  `            await saveUserData(prev => ({ ...prev, library: updatedLibrary } as any));\n            handleCancelEdit(); // Reset form`,
  `            const savedExercise = editingExId\n                ? updatedLibrary.find(ex => ex.id === editingExId)\n                : updatedLibrary.find(ex => !library.some(current => current.id === ex.id));\n            if (!savedExercise) throw new Error('Esercizio non trovato dopo la modifica');\n            await dispatchDomainOperation({ type: 'exercise.upsert', exercise: savedExercise });\n            handleCancelEdit(); // Reset form`,
);
replaceOne(
  'src/hooks/useTrainingExercises.ts',
  `                await saveUserData(prev => ({ ...prev, library: updatedLibrary } as any));\n                if (editingExId === id) handleCancelEdit();`,
  `                await dispatchDomainOperation({ type: 'exercise.delete', id });\n                if (editingExId === id) handleCancelEdit();`,
);
replaceOne(
  'src/hooks/useTrainingExercises.ts',
  `                await saveUserData(prev => ({ ...prev, library: updatedLibrary } as any));\n                // Aggiorna anche il form corrente se è aperto`,
  `                await dispatchDomainOperation({ type: 'exercise.upsert', exercise: { ...originalEx, setsCount: originalEx.setsCount ?? 3, sets: [] } as any });\n                // Aggiorna anche il form corrente se è aperto`,
);

replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `    const saveUserData = useAppStore(state => state.saveUserData);`,
  `    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);`,
);
replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `            await saveUserData((prev) => {\n                if (!prev) return prev;\n                const isMostRecent = prev.history && prev.history.length > 0 && prev.history[0].id === targetId;\n                const updatedHistory = (prev.history || []).map(w => (w.id === targetId ? updatedWorkout : w));\n                \n                let finalActivePains = prev.activePains || [];\n                if (isMostRecent) {\n                    finalActivePains = Logic.autoHealPains(\n                        prev.activePains || [],\n                        updatedWorkout.exercises || [],\n                        prev.library || [],\n                        updatedWorkout.pains || []\n                    );\n                }\n\n                return { \n                    ...prev, \n                    history: updatedHistory, \n                    activeWorkout: null,\n                    ...(isMostRecent && { activePains: finalActivePains })\n                };\n            });`,
  `            const currentData = useAppStore.getState().userData;\n            if (!currentData) throw new Error('Dati utente non caricati');\n            const isMostRecent = Boolean(currentData.history?.length && currentData.history[0].id === targetId);\n            const finalActivePains = isMostRecent\n                ? Logic.autoHealPains(\n                    currentData.activePains || [],\n                    updatedWorkout.exercises || [],\n                    currentData.library || [],\n                    updatedWorkout.pains || []\n                )\n                : (currentData.activePains || []);\n            await dispatchDomainOperation([\n                { type: 'history.upsert', workout: updatedWorkout },\n                { type: 'active-workout.set', workout: null },\n                { type: 'active-pains.set', pains: finalActivePains },\n            ]);`,
);
replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `    }, [mood, pump, fatigue, water, manualDuration, saveUserData, setLocalWorkout, showAlert]);`,
  `    }, [mood, pump, fatigue, water, manualDuration, dispatchDomainOperation, setLocalWorkout, showAlert]);`,
);
replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `            await saveUserData((prev) => {\n                if (!prev) return prev;\n                const currentActivePains = prev.activePains || [];\n                const finalActivePains = Logic.autoHealPains(\n                    currentActivePains,\n                    finishedWorkout.exercises || [],\n                    prev.library || [],\n                    sessionPains\n                );\n\n                return {\n                    ...prev,\n                    history: [finishedWorkout, ...(prev.history || []).filter(item => item.id !== finishedWorkout.id)],\n                    activeWorkout: null,\n                    activePains: finalActivePains\n                };\n            });`,
  `            const currentData = useAppStore.getState().userData;\n            if (!currentData) throw new Error('Dati utente non caricati');\n            const finalActivePains = Logic.autoHealPains(\n                currentData.activePains || [],\n                finishedWorkout.exercises || [],\n                currentData.library || [],\n                sessionPains\n            );\n            await dispatchDomainOperation({\n                type: 'workout.complete',\n                workout: finishedWorkout,\n                activePains: finalActivePains,\n            });`,
);
replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `    }, [showConfirm, saveUserData, setLocalWorkout, showAlert]);`,
  `    }, [showConfirm, dispatchDomainOperation, setLocalWorkout, showAlert]);`,
);
replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `            await saveUserData((prev) => {\n                if (!prev) return prev;\n                return { ...prev, activeWorkout: null };\n            });`,
  `            await dispatchDomainOperation({ type: 'active-workout.set', workout: null });`,
);
replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `    }, [showConfirm, saveUserData, setLocalWorkout, showAlert]);`,
  `    }, [showConfirm, dispatchDomainOperation, setLocalWorkout, showAlert]);`,
);
replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `            await saveUserData((prev) => {\n                if (!prev) return prev;\n                const updatedLibrary = (prev.library || []).map((l: any) => l.id === exId ? { ...l, notes: note } : l);\n                return { ...prev, library: updatedLibrary };\n            });`,
  `            const exercise = useAppStore.getState().userData?.library?.find(item => item.id === exId);\n            if (!exercise) throw new Error('Esercizio non trovato');\n            await dispatchDomainOperation({ type: 'exercise.upsert', exercise: { ...exercise, notes: note } });`,
);
replaceOne(
  'src/hooks/useWorkoutSession.ts',
  `    }, [saveUserData, showAlert]);`,
  `    }, [dispatchDomainOperation, showAlert]);`,
);

console.log('M8 deterministic consumer migration applied');
