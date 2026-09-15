from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} occurrence(s), found {count}: {old!r}')
    file.write_text(text.replace(old, new), encoding='utf-8')


# Store: preserve local-only infrastructure setter and add an explicit synced user-action setter.
replace_exact(
    'src/store/slices/createWorkoutSlice.ts',
    "import type { WorkoutSession, SessionExercise, SessionExerciseSet } from '../../types';",
    "import type { WorkoutSession, SessionExercise, SessionExerciseSet, SyncResult } from '../../types';",
)
replace_exact(
    'src/store/slices/createWorkoutSlice.ts',
    "    setLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => void;\n}",
    "    setLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => void;\n    setSyncedLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => Promise<SyncResult>;\n}",
)
replace_exact(
    'src/store/slices/createWorkoutSlice.ts',
    'export const createWorkoutSlice: StateCreator<AppState, [], [], WorkoutSlice> = (set) => ({',
    'export const createWorkoutSlice: StateCreator<AppState, [], [], WorkoutSlice> = (set, get) => ({',
)
replace_exact(
    'src/store/slices/createWorkoutSlice.ts',
    '''    setLocalWorkout: (workoutOrUpdater) => {
        set((state) => {
            const nextWorkout = typeof workoutOrUpdater === 'function'
                ? (workoutOrUpdater as (prev: WorkoutSession | null) => WorkoutSession | null)(state.localWorkout)
                : workoutOrUpdater;
            debouncedSaveLocalStorage(nextWorkout);
            const nextUserData = state.userData ? { ...state.userData, activeWorkout: nextWorkout || null } : null;
            return { localWorkout: nextWorkout, userData: nextUserData };
        });
    },
});''',
    '''    setLocalWorkout: (workoutOrUpdater) => {
        set((state) => {
            const nextWorkout = typeof workoutOrUpdater === 'function'
                ? (workoutOrUpdater as (prev: WorkoutSession | null) => WorkoutSession | null)(state.localWorkout)
                : workoutOrUpdater;
            debouncedSaveLocalStorage(nextWorkout);
            const nextUserData = state.userData ? { ...state.userData, activeWorkout: nextWorkout || null } : null;
            return { localWorkout: nextWorkout, userData: nextUserData };
        });
    },

    setSyncedLocalWorkout: async (workoutOrUpdater) => {
        const currentWorkout = get().localWorkout;
        const nextWorkout = typeof workoutOrUpdater === 'function'
            ? (workoutOrUpdater as (prev: WorkoutSession | null) => WorkoutSession | null)(currentWorkout)
            : workoutOrUpdater;

        if (nextWorkout === currentWorkout) return { ok: true, status: 'synced' };
        if (!get().userData) throw new Error('Dati utente non caricati');
        if (nextWorkout) {
            const id = String(nextWorkout.id ?? '').trim();
            if (!id || id === 'undefined' || id === 'null' || id.includes('/')) {
                throw new Error('Allenamento attivo: identificativo non valido');
            }
        }

        // Persist the device-local draft first, but leave userData untouched until the
        // DomainOperation reducer runs. This preserves the old snapshot as compiler base.
        debouncedSaveLocalStorage(nextWorkout);
        set({ localWorkout: nextWorkout });
        return get().dispatchDomainOperation({ type: 'active-workout.set', workout: nextWorkout });
    },
});''',
)

# Hook: route ordinary active-session mutations through the synced setter, while history editing remains local-only.
replace_exact(
    'src/hooks/useWorkoutSession.ts',
    '''    const localWorkout = useAppStore(state => state.localWorkout);
    const setLocalWorkout = useAppStore(state => state.setLocalWorkout);''',
    '''    const localWorkout = useAppStore(state => state.localWorkout);
    const setLocalWorkout = useAppStore(state => state.setLocalWorkout);
    const setSyncedLocalWorkout = useAppStore(state => state.setSyncedLocalWorkout);''',
)
replace_exact(
    'src/hooks/useWorkoutSession.ts',
    '''    const [selectedRoutine, setSelectedRoutine] = useState('');
    const endingRef = useRef(false);
    
    // Rating states derivati direttamente da activeWorkout per prevenire perdita di dati''',
    '''    const [selectedRoutine, setSelectedRoutine] = useState('');
    const endingRef = useRef(false);

    const mutateActiveWorkout = useCallback((
        workoutOrUpdater: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)
    ) => {
        const current = useAppStore.getState().localWorkout;
        if (current?.isEditingHistory) {
            setLocalWorkout(workoutOrUpdater);
            return;
        }
        // Input-level mutations remain non-blocking; syncHealth/saveError surface failures.
        void setSyncedLocalWorkout(workoutOrUpdater).catch(() => {});
    }, [setLocalWorkout, setSyncedLocalWorkout]);
    
    // Rating states derivati direttamente da activeWorkout per prevenire perdita di dati''',
)
for name, field, cast in [
    ('setMood', 'moodRating', 'val as any'),
    ('setPump', 'pumpRating', 'val as any'),
    ('setFatigue', 'fatigueRating', 'val as any'),
    ('setWater', 'waterLiters', 'val as any'),
]:
    old = f'''    const {name} = useCallback((val: string) => {{\n        setLocalWorkout(prev => prev ? {{ ...prev, {field}: {cast} }} : null);\n    }}, [setLocalWorkout]);'''
    new = f'''    const {name} = useCallback((val: string) => {{\n        mutateActiveWorkout(prev => prev ? {{ ...prev, {field}: {cast} }} : null);\n    }}, [mutateActiveWorkout]);'''
    replace_exact('src/hooks/useWorkoutSession.ts', old, new)
replace_exact(
    'src/hooks/useWorkoutSession.ts',
    '''    const setManualDuration = useCallback((val: string) => {
        setLocalWorkout(prev => prev ? { ...prev, manualDurationStr: val } : null);
    }, [setLocalWorkout]);''',
    '''    const setManualDuration = useCallback((val: string) => {
        mutateActiveWorkout(prev => prev ? { ...prev, manualDurationStr: val } : null);
    }, [mutateActiveWorkout]);''',
)
replace_exact(
    'src/hooks/useWorkoutSession.ts',
    '''    const setPains = useCallback((newPains: string[]) => {
        setLocalWorkout(prev => prev ? { ...prev, pains: newPains } : null);
    }, [setLocalWorkout]);''',
    '''    const setPains = useCallback((newPains: string[]) => {
        mutateActiveWorkout(prev => prev ? { ...prev, pains: newPains } : null);
    }, [mutateActiveWorkout]);''',
)
replace_exact(
    'src/hooks/useWorkoutSession.ts',
    '''        setLocalWorkout(prev => {
            if (!prev) return null;
            const currentPains = Array.isArray(prev.pains) ? prev.pains : [];
            const nextPains = currentPains.includes(muscleId)
                ? currentPains.filter(p => p !== muscleId)
                : [...currentPains, muscleId];
            return { ...prev, pains: nextPains };
        });
    }, [setLocalWorkout]);''',
    '''        mutateActiveWorkout(prev => {
            if (!prev) return null;
            const currentPains = Array.isArray(prev.pains) ? prev.pains : [];
            const nextPains = currentPains.includes(muscleId)
                ? currentPains.filter(p => p !== muscleId)
                : [...currentPains, muscleId];
            return { ...prev, pains: nextPains };
        });
    }, [mutateActiveWorkout]);''',
)
replace_exact(
    'src/hooks/useWorkoutSession.ts',
    '    } = useWorkoutSetMutations({ setLocalWorkout, showConfirm });',
    '    } = useWorkoutSetMutations({ setLocalWorkout: mutateActiveWorkout, showConfirm });',
)
replace_exact('src/hooks/useWorkoutSession.ts', '        setLocalWorkout(newActiveWorkout);', '        mutateActiveWorkout(newActiveWorkout);', expected=2)
replace_exact(
    'src/hooks/useWorkoutSession.ts',
    '    }, [selectedRoutine, showAlert, setLocalWorkout]);',
    '    }, [selectedRoutine, showAlert, mutateActiveWorkout]);',
)
replace_exact(
    'src/hooks/useWorkoutSession.ts',
    '    }, [showAlert, setLocalWorkout]);',
    '    }, [showAlert, mutateActiveWorkout]);',
)

# Reducer contract: every non-null cloud active workout requires stable identity.
replace_exact(
    'src/lib/sync/domainOperations.ts',
    '''        case 'active-workout.set':
            if (operation.workout?.id !== undefined) requireId(operation.workout.id, 'Allenamento attivo');
            data.activeWorkout = operation.workout ? structuredClone(operation.workout) : null;
            break;''',
    '''        case 'active-workout.set':
            if (operation.workout) requireId(operation.workout.id, 'Allenamento attivo');
            data.activeWorkout = operation.workout ? structuredClone(operation.workout) : null;
            break;''',
)

# Domain-level regression coverage for guarded child updates and identity fail-fast.
test_path = Path('tests/m8_domain_operations.test.ts')
test_text = test_path.read_text(encoding='utf-8')
marker = '''    it('keeps the exercise archive deterministically sorted after an upsert', () => {
        const before = base({ library: [
            { id: 'e-z', name: 'Zeta', setsCount: 3, sets: [] },
        ] });
        const { after } = compile(before, {
            type: 'exercise.upsert',
            exercise: { id: 'e-a', name: 'Alfa', setsCount: 3, sets: [] },
        });

        expect(after.library?.map(item => item.id)).toEqual(['e-a', 'e-z']);
    });
});
'''
replacement = '''    it('keeps the exercise archive deterministically sorted after an upsert', () => {
        const before = base({ library: [
            { id: 'e-z', name: 'Zeta', setsCount: 3, sets: [] },
        ] });
        const { after } = compile(before, {
            type: 'exercise.upsert',
            exercise: { id: 'e-a', name: 'Alfa', setsCount: 3, sets: [] },
        });

        expect(after.library?.map(item => item.id)).toEqual(['e-a', 'e-z']);
    });

    it('guards child mutations of the same active workout by session id', () => {
        const active: WorkoutSession = { id: 'live-1', date: '2026-09-15', moodRating: 1, exercises: [] };
        const before = base({ activeWorkout: active });
        const next = { ...active, moodRating: 4 };
        const { operations } = compile(before, { type: 'active-workout.set', workout: next });

        expect(operations).toContainEqual(expect.objectContaining({
            path: ['activeWorkout', 'moodRating'],
            guard: { path: ['activeWorkout', 'id'], equals: 'live-1' },
        }));
        expect(operations.filter(op => op.path[0] === 'activeWorkout' && op.path.length > 1)
            .every(op => op.guard?.equals === 'live-1')).toBe(true);
    });

    it('rejects a non-null active workout without stable identity', () => {
        const before = base({ activeWorkout: null });
        expect(() => applyDomainOperations(before, {
            type: 'active-workout.set',
            workout: { date: '2026-09-15', exercises: [] },
        })).toThrow(/identificativo non valido/i);
    });
});
'''
if test_text.count(marker) != 1:
    raise SystemExit('tests/m8_domain_operations.test.ts: active-workout insertion marker not found exactly once')
test_path.write_text(test_text.replace(marker, replacement), encoding='utf-8')

# Static contract: ordinary workout editing must use the synced boundary; local-only setter remains for history/infra paths.
boundary = Path('scripts/check-m8-domain-boundary.mjs')
boundary_text = boundary.read_text(encoding='utf-8')
marker = '''for (const [file, expected] of allowedSnapshotSelectors) {
  if (!files.includes(file)) violations.push(`${file}: documented bulk-boundary allowlist file missing`);
  if (expected < 1) violations.push(`${file}: invalid allowlist count`);
}

if (violations.length) {'''
replacement = '''for (const [file, expected] of allowedSnapshotSelectors) {
  if (!files.includes(file)) violations.push(`${file}: documented bulk-boundary allowlist file missing`);
  if (expected < 1) violations.push(`${file}: invalid allowlist count`);
}

const workoutSession = fs.readFileSync('src/hooks/useWorkoutSession.ts', 'utf8');
const workoutSlice = fs.readFileSync('src/store/slices/createWorkoutSlice.ts', 'utf8');
for (const [label, source, pattern] of [
  ['active workout synced selector', workoutSession, /state => state\.setSyncedLocalWorkout/],
  ['active workout mutation adapter', workoutSession, /setLocalWorkout:\s*mutateActiveWorkout/],
  ['active workout start path', workoutSession, /mutateActiveWorkout\(newActiveWorkout\)/],
  ['active workout domain dispatch', workoutSlice, /dispatchDomainOperation\(\{ type: 'active-workout\.set', workout: nextWorkout \}\)/],
]) {
  if (!pattern.test(source)) violations.push(`${label}: missing M8 active-workout DomainOperation boundary`);
}

if (violations.length) {'''
if boundary_text.count(marker) != 1:
    raise SystemExit('scripts/check-m8-domain-boundary.mjs: active-workout contract marker not found exactly once')
boundary.write_text(boundary_text.replace(marker, replacement), encoding='utf-8')
