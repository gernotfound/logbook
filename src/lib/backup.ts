import equal from 'fast-deep-equal';
import { UserDataSchema } from './schema';
import type { UserData } from '../types';
import { getLocalDateString } from './utils/date';
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

export function validateImportData(value: unknown): asserts value is Record<string, unknown> {
    if (!isRecord(value)) throw new Error('Dati del backup non validi. Il file originale non è stato modificato.');
    const checkIds = (items: unknown, path: string) => {
        if (!Array.isArray(items)) throw new Error(`${path}: atteso un elenco.`);
        const ids = new Set<string>();
        for (const item of items) {
            if (!isRecord(item) || !((typeof item.id === 'string' && item.id.trim()) || (typeof item.id === 'number' && Number.isFinite(item.id)))) {
                throw new Error(`${path}: elemento senza identificativo valido.`);
            }
            const id = String(item.id);
            if (ids.has(id)) throw new Error(`${path}: identificativo duplicato ${id}.`);
            ids.add(id);
        }
    };
    for (const key of arrays) if (value[key] !== undefined) checkIds(value[key], key);
    for (const key of ['profile', 'nutrition', 'catalogOverrides', 'pendingConflicts']) {
        if (value[key] !== undefined && !isRecord(value[key])) throw new Error(`${key}: atteso un oggetto.`);
    }
    if (isRecord(value.nutrition)) for (const [date, day] of Object.entries(value.nutrition)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || getLocalDateString(new Date(`${date}T12:00:00`)) !== date || !isRecord(day)) {
            throw new Error(`Giornata nutrizione non valida: ${date}.`);
        }
        for (const key of ['meals', 'supplementsIntake']) if (day[key] !== undefined) checkIds(day[key], `nutrition.${date}.${key}`);
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

    // Container, data schema and sync protocol are normalized as independent dimensions.
    const normalized = normalizeBackupRecord(payload);
    if (normalized.format !== 'logbook-backup') throw new Error('Formato file non valido o non supportato.');

    if (normalized.type !== 'backup' && normalized.type !== 'share') {
        throw new Error('Tipo file non valido o non supportato.');
    }

    const share = normalized.type === 'share';
    const sourceOwner = typeof normalized.owner === 'string' ? normalized.owner : null;
    if (!share && sourceOwner && sourceOwner !== owner) {
        throw new Error('Sicurezza: Non puoi importare il backup di un altro utente. Accedi con il proprietario del backup.');
    }

    const data = normalized.userData;
    validateImportData(data);
    const selected = share
        ? Object.fromEntries(arrays.filter(key => ['library', 'routines', 'trainingCycles'].includes(key) && data[key] !== undefined).map(key => [key, data[key]]))
        : data;

    return {
        data: selected,
        share,
        ownerUnknown: !share && !sourceOwner,
        coverage: !share && isRecord(normalized.coverage) ? normalized.coverage : undefined,
    };
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
    if (isRecord(local) && isRecord(incoming)) return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(incoming)])].map(key =>
        [key, Object.hasOwn(incoming, key) ? mergeMissing(local[key], incoming[key]) : structuredClone(local[key])]));
    return structuredClone(local);
}

export function prepareImport(current: UserData, incoming: Record<string, unknown>, mode: ImportMode): { data: UserData; collisions: number } {
    let collisions = 0;
    for (const key of arrays) {
        if (!Array.isArray(incoming[key])) continue;
        const local = new Map((current[key] ?? []).map(item => [String(item.id), item]));
        for (const item of incoming[key] as Array<{ id: string }>) if (local.has(String(item.id)) && !equal(local.get(String(item.id)), item)) collisions++;
    }
    for (const [date, day] of Object.entries(isRecord(incoming.nutrition) ? incoming.nutrition : {})) {
        if (current.nutrition?.[date] && !equal(current.nutrition[date], day)) collisions++;
    }
    const raw = mode === 'restore' ? { ...structuredClone(current), ...structuredClone(incoming) } : mergeMissing(current, incoming);
    const data = UserDataSchema.parse({ ...(raw as Record<string, unknown>), legalConsent: current.legalConsent }) as unknown as UserData;
    if (mode === 'merge') for (const [date, day] of Object.entries(data.nutrition ?? {})) {
        if (!isRecord(incoming.nutrition) || !incoming.nutrition[date] || equal(day.meals, current.nutrition?.[date]?.meals) || !day.meals?.length) continue;
        const totals = { kcal: 0, carbs: 0, pro: 0, fat: 0 };
        for (const meal of day.meals) {
            const base = meal.baseQty && meal.baseQty > 0 ? meal.baseQty : (meal.unit === 'porzione' || meal.meal === 'quick' ? 1 : 100);
            for (const key of ['kcal', 'carbs', 'pro', 'fat'] as const) totals[key] += Number(meal[key]) * Number(meal.quantity) / base;
        }
        Object.assign(day, { kcal: Math.round(totals.kcal), carbs: Math.round(totals.carbs * 10) / 10, pro: Math.round(totals.pro * 10) / 10, fat: Math.round(totals.fat * 10) / 10 });
    }
    return { data, collisions };
}
