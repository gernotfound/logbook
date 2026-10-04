import equal from 'fast-deep-equal';
import { DomainParsers, UserDataSchema } from './schema';
import type { UserData } from '../types';
import { getLocalDateString } from './utils/date';
import { normalizeBusinessId } from './businessIdentity';
import { requireCanonicalWorkoutDate } from './sync/monthlyIntegrity';
import { assertWorkoutSessionIdentities } from './sync/domainOperations/validation';
import {
    CURRENT_BACKUP_SCHEMA,
    CURRENT_DATA_SCHEMA,
    CURRENT_SYNC_PROTOCOL,
    normalizeBackupRecord,
} from './schemaEvolution';

export type ImportMode = 'merge' | 'restore';
export interface BackupCoverage {
    scope: 'device' | 'cloud-and-device';
    months: string[];
    readStartedAt?: string;
    readCompletedAt?: string;
}
export interface BackupPayload {
    format: 'logbook-backup';
    version: typeof CURRENT_BACKUP_SCHEMA;
    dataSchemaVersion: typeof CURRENT_DATA_SCHEMA;
    syncProtocolVersion: typeof CURRENT_SYNC_PROTOCOL;
    type: 'backup';
    owner: string | null;
    exportedAt: string;
    coverage: BackupCoverage;
    userData: UserData;
    recovery?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const arrays = ['library', 'routines', 'history', 'customFoods', 'trainingCycles', 'supplements'] as const;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseBackupCoverage(value: unknown): BackupCoverage {
    if (!isRecord(value)) throw new Error('Coverage del backup mancante o non valida.');
    if (value.scope !== 'device' && value.scope !== 'cloud-and-device') {
        throw new Error('Coverage del backup non valida: scope sconosciuto.');
    }
    if (!Array.isArray(value.months) || value.months.some(month => typeof month !== 'string' || !MONTH_RE.test(month))) {
        throw new Error('Coverage del backup non valida: mesi non validi.');
    }
    const months = value.months as string[];
    if (new Set(months).size !== months.length) throw new Error('Coverage del backup non valida: mesi duplicati.');
    if (value.readStartedAt !== undefined && typeof value.readStartedAt !== 'string') {
        throw new Error('Coverage del backup non valida: inizio lettura non valido.');
    }
    if (value.readCompletedAt !== undefined && typeof value.readCompletedAt !== 'string') {
        throw new Error('Coverage del backup non valida: fine lettura non valida.');
    }
    return {
        scope: value.scope,
        months: [...months],
        ...(value.readStartedAt !== undefined ? { readStartedAt: value.readStartedAt } : {}),
        ...(value.readCompletedAt !== undefined ? { readCompletedAt: value.readCompletedAt } : {}),
    };
}

export function validateImportData(value: unknown): asserts value is Record<string, unknown> {
    if (!isRecord(value)) throw new Error('Dati del backup non validi. Il file originale non è stato modificato.');
    const checkIds = (items: unknown, path: string) => {
        if (!Array.isArray(items)) throw new Error(`${path}: atteso un elenco.`);
        const ids = new Set<string>();
        for (const item of items) {
            const rawId = isRecord(item) ? item.id : undefined;
            const id = normalizeBusinessId(rawId);
            if (!id) throw new Error(`${path}: identificativo non valido.`);
            if (ids.has(id)) throw new Error(`${path}: identificativo duplicato ${id}.`);
            ids.add(id);
        }
    };
    for (const key of arrays) if (value[key] !== undefined) checkIds(value[key], key);

    if (Array.isArray(value.history)) {
        const ids = new Set<string>();
        for (const item of value.history) {
            const rawId = isRecord(item) ? item.id : undefined;
            const id = normalizeBusinessId(rawId);
            if (!id) throw new Error('history: elemento senza identificativo valido.');
            if (ids.has(id)) throw new Error(`history: identificativo duplicato ${id}.`);
            ids.add(id);
            if (!isRecord(item)) throw new Error('history: elemento non valido.');
            assertWorkoutSessionIdentities(item as any, `history.${id}`);
            requireCanonicalWorkoutDate(item as any, `history.${id}`);
        }
    }

    if (Array.isArray(value.routines)) for (const [index, routine] of value.routines.entries()) {
        if (!isRecord(routine) || routine.exercises === undefined) continue;
        if (!Array.isArray(routine.exercises)) throw new Error(`routines.${index}.exercises: atteso un elenco.`);
        const seen = new Set<string>();
        for (const exercise of routine.exercises) {
            if (!isRecord(exercise)) throw new Error(`routines.${index}.exercises: elemento senza identificativo valido.`);
            const normalized = normalizeBusinessId(exercise.exId);
            if (!normalized) throw new Error(`routines.${index}.exercises: esercizio senza identificativo valido.`);
            if (seen.has(normalized)) throw new Error(`routines.${index}.exercises: identificativo duplicato ${normalized}.`);
            seen.add(normalized);
        }
    }

    if (Array.isArray(value.trainingCycles)) for (const [index, cycle] of value.trainingCycles.entries()) {
        if (!isRecord(cycle) || cycle.routines === undefined) continue;
        if (!Array.isArray(cycle.routines)) throw new Error(`trainingCycles.${index}.routines: atteso un elenco.`);
        const seen = new Set<string>();
        for (const routine of cycle.routines) {
            if (!isRecord(routine)) throw new Error(`trainingCycles.${index}.routines: elemento senza identificativo valido.`);
            const normalized = normalizeBusinessId(routine.routineId);
            if (!normalized) throw new Error(`trainingCycles.${index}.routines: routine senza identificativo valido.`);
            if (seen.has(normalized)) throw new Error(`trainingCycles.${index}.routines: identificativo duplicato ${normalized}.`);
            seen.add(normalized);
        }
    }

    for (const key of ['profile', 'nutrition', 'catalogOverrides', 'pendingConflicts']) {
        if (value[key] !== undefined && !isRecord(value[key])) throw new Error(`${key}: atteso un oggetto.`);
    }
    if (isRecord(value.nutrition)) for (const [date, day] of Object.entries(value.nutrition)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || getLocalDateString(new Date(`${date}T12:00:00`)) !== date || !isRecord(day) || day.date !== date) {
            throw new Error(`Giornata nutrizione non valida o incoerente: ${date}.`);
        }
        for (const key of ['meals', 'supplementsIntake', 'cardioSessions']) {
            if (day[key] === undefined) continue;
            checkIds(day[key], `nutrition.${date}.${key}`);
            for (const item of day[key] as unknown[]) {
                if (!isRecord(item)) continue;
                const normalizedId = normalizeBusinessId(item.id);
                if (!normalizedId) throw new Error(`nutrition.${date}.${key}: identificativo non valido.`);
                if (key === 'supplementsIntake') {
                    const normalizedSupplementId = normalizeBusinessId(item.supplementId);
                    if (!normalizedSupplementId) {
                        throw new Error(`nutrition.${date}.supplementsIntake: integratore senza identificativo valido.`);
                    }
                }
            }
        }
    }
}

export function createBackup(userData: UserData, owner: string | null, coverage: BackupCoverage = { scope: 'device', months: [] }, recovery?: unknown): BackupPayload {
    return {
        format: 'logbook-backup',
        version: CURRENT_BACKUP_SCHEMA,
        dataSchemaVersion: CURRENT_DATA_SCHEMA,
        syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
        type: 'backup',
        owner,
        exportedAt: new Date().toISOString(),
        coverage,
        userData: structuredClone(userData),
        recovery,
    };
}

export function decodeImport(payload: unknown, owner: string) {
    if (!isRecord(payload) || payload.format !== 'logbook-backup') {
        throw new Error('Formato file non valido o non supportato.');
    }

    const normalized = normalizeBackupRecord(payload);
    if (normalized.format !== 'logbook-backup') throw new Error('Formato file non valido o non supportato.');
    if (normalized.type !== 'backup' && normalized.type !== 'share') throw new Error('Tipo file non valido o non supportato.');

    const share = normalized.type === 'share';
    const coverage = share ? undefined : parseBackupCoverage(normalized.coverage);
    const sourceOwner = typeof normalized.owner === 'string' ? normalized.owner : null;
    if (!share && sourceOwner && sourceOwner !== owner) {
        throw new Error('Sicurezza: Non puoi importare il backup di un altro utente. Accedi con il proprietario del backup.');
    }

    const data = normalized.userData;
    validateImportData(data);
    const sanitizedData = structuredClone(data);
    if (sanitizedData.activeWorkout !== undefined && sanitizedData.activeWorkout !== null) {
        const activeWorkout = DomainParsers.parseActiveWorkout(sanitizedData.activeWorkout);
        try {
            if (activeWorkout) assertWorkoutSessionIdentities(activeWorkout, 'activeWorkout');
            sanitizedData.activeWorkout = activeWorkout;
        } catch {
            sanitizedData.activeWorkout = null;
        }
    }
    const selected = share
        ? Object.fromEntries(arrays.filter(key => ['library', 'routines', 'trainingCycles'].includes(key) && sanitizedData[key] !== undefined).map(key => [key, sanitizedData[key]]))
        : sanitizedData;

    return { data: selected, share, ownerUnknown: !share && !sourceOwner, coverage };
}

function mergeMissing(local: unknown, incoming: unknown): unknown {
    if (local === undefined || local === null || local === '') return structuredClone(incoming);
    if (Array.isArray(local) && Array.isArray(incoming)) {
        if ([...local, ...incoming].every(item => isRecord(item) && item.id !== undefined)) {
            const merged = new Map(local.map(item => [String(item.id), structuredClone(item)]));
            for (const item of incoming) if (!merged.has(String(item.id))) merged.set(String(item.id), structuredClone(item));
            return [...merged.values()];
        }
        return [...new Set([...local, ...incoming])];
    }
    if (isRecord(local) && isRecord(incoming)) {
        return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(incoming)])].map(key =>
            [key, Object.hasOwn(incoming, key) ? mergeMissing(local[key], incoming[key]) : structuredClone(local[key])]));
    }
    return structuredClone(local);
}

function restoreWithCoverage(current: UserData, incoming: Record<string, unknown>, coverage?: BackupCoverage): Record<string, unknown> {
    const restored = { ...structuredClone(current), ...structuredClone(incoming) } as Record<string, unknown>;
    if (coverage?.scope !== 'cloud-and-device') {
        if (Array.isArray(incoming.history)) {
            const historyById = new Map<string, unknown>();
            for (const item of current.history ?? []) {
                const id = normalizeBusinessId(item.id);
                if (id) historyById.set(id, structuredClone(item));
            }
            for (const item of incoming.history) {
                const id = isRecord(item) ? normalizeBusinessId(item.id) : null;
                if (id) historyById.set(id, structuredClone(item));
            }
            restored.history = [...historyById.values()];
        }
        if (isRecord(incoming.nutrition)) {
            restored.nutrition = { ...structuredClone(current.nutrition ?? {}), ...structuredClone(incoming.nutrition) };
        }
    }
    return restored;
}

export function prepareImport(current: UserData, incoming: Record<string, unknown>, mode: ImportMode, coverage?: BackupCoverage): { data: UserData; collisions: number } {
    let collisions = 0;
    for (const key of arrays) {
        if (!Array.isArray(incoming[key])) continue;
        const local = new Map((current[key] ?? []).map(item => [String(item.id), item]));
        for (const item of incoming[key] as Array<{ id: string }>) {
            if (local.has(String(item.id)) && !equal(local.get(String(item.id)), item)) collisions++;
        }
    }
    for (const [date, day] of Object.entries(isRecord(incoming.nutrition) ? incoming.nutrition : {})) {
        if (current.nutrition?.[date] && !equal(current.nutrition[date], day)) collisions++;
    }
    const raw = mode === 'restore' ? restoreWithCoverage(current, incoming, coverage) : mergeMissing(current, incoming);
    const data = UserDataSchema.parse({ ...(raw as Record<string, unknown>), legalConsent: current.legalConsent }) as unknown as UserData;
    if (mode === 'merge') for (const [date, day] of Object.entries(data.nutrition ?? {})) {
        if (!isRecord(incoming.nutrition) || !incoming.nutrition[date] || equal(day.meals, current.nutrition?.[date]?.meals) || !day.meals?.length) continue;
        const totals = { kcal: 0, carbs: 0, pro: 0, fat: 0 };
        for (const meal of day.meals) {
            const base = meal.baseQty && meal.baseQty > 0 ? meal.baseQty : (meal.unit === 'porzione' || meal.meal === 'quick' ? 1 : 100);
            for (const key of ['kcal', 'carbs', 'pro', 'fat'] as const) totals[key] += Number(meal[key]) * Number(meal.quantity) / base;
        }
        Object.assign(day, {
            kcal: Math.round(totals.kcal),
            carbs: Math.round(totals.carbs * 10) / 10,
            pro: Math.round(totals.pro * 10) / 10,
            fat: Math.round(totals.fat * 10) / 10
        });
    }
    return { data, collisions };
}
