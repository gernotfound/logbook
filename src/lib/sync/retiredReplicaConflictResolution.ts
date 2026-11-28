import equal from 'fast-deep-equal';
import { NutritionDaySchema } from '../schemas/schema_nutrition';
import { WorkoutSessionSchema } from '../schemas/schema_training';
import { findLossyNormalization } from './businessNormalizationIntegrity';
import { parseRetiredReplicaConflictCapsule, type RetiredReplicaConflictCapsule } from './retiredReplicaConflictRecord';

type MergeResult = { safe: true; value: unknown } | { safe: false };

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

// Absence and an explicit null are distinct business states. An absent field
// is never silently reconstructed from the other replica's deletion.
const missing = Symbol('missing-field');

function mergeField(base: unknown, device: unknown, cloud: unknown): MergeResult {
    if (equal(device, cloud)) return { safe: true, value: device };
    if (equal(device, base)) return { safe: true, value: cloud };
    if (equal(cloud, base)) return { safe: true, value: device };
    // Two independently inserted objects under the same business ID may have
    // different authors/meaning: a field union would invent a single entity.
    if (!object(base) || !object(device) || !object(cloud)) return { safe: false };
    const merged: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(device), ...Object.keys(cloud)])) {
        const pick = (source: Record<string, unknown>) => Object.hasOwn(source, key) ? source[key] : missing;
        const next = mergeField(pick(base), pick(device), pick(cloud));
        if (!next.safe) return next;
        // Field removal is not an independent additive edit: derived business
        // data may depend on its old value even if another field changed.
        if (next.value === missing && Object.hasOwn(base, key)) return { safe: false };
        if (next.value !== missing) Object.defineProperty(merged, key, {
            value: next.value, enumerable: true, configurable: true, writable: true,
        });
    }
    return { safe: true, value: merged };
}

function coherentBusiness(kind: string, id: string, path: unknown, value: unknown): boolean {
    // The active workout has session lifecycle guards beyond its fields. Do
    // not propose automatically joining that session from two devices.
    if (kind === 'active-workout' || typeof path !== 'string' || !object(value)) return false;
    if (kind === 'nutrition') {
        const result = NutritionDaySchema.safeParse(value);
        return path === `nutrition_months/${id.slice(0, 7)}` && result.success
            && result.data.date === id && !findLossyNormalization(value, result.data);
    }
    if (kind === 'history') {
        const result = WorkoutSessionSchema.safeParse(value);
        return result.success && result.data.id === id
            && typeof result.data.date === 'string'
            && path === `history_months/${result.data.date.slice(0, 7)}`
            && !findLossyNormalization(value, result.data);
    }
    return false;
}

export type RetiredConflictResolutionDraft =
    | { kind: 'automatic-candidate'; entityKind: 'history' | 'nutrition' | 'active-workout';
        entityId: string; docPath: string | null; value: unknown }
    | { kind: 'manual-required'; entityKind: 'history' | 'nutrition' | 'active-workout'; entityId: string };

/**
 * A pure three-way preview, NOT a cloud writer or an authorization to rebase.
 * Array edits, concurrent additions/deletions and incompatible moves remain
 * manual: only the later full-cloud/session/consent/receipt fences can decide
 * whether a proposed result may enter a fresh causal journal.
 */
export function previewRetiredReplicaConflictResolution(
    capsule: RetiredReplicaConflictCapsule,
): RetiredConflictResolutionDraft[] {
    const verified = parseRetiredReplicaConflictCapsule(capsule, capsule.owner);
    return verified.entries.map<RetiredConflictResolutionDraft>(entry => {
        const baselinePath = entry.baseline?.docPath ?? null;
        const devicePath = entry.device?.docPath ?? null;
        const cloudPath = entry.cloud?.docPath ?? null;
        const docPath = mergeField(
            baselinePath, devicePath, cloudPath,
        );
        const value = mergeField(
            entry.baseline === null ? missing : entry.baseline.value,
            entry.device === null ? missing : entry.device.value,
            entry.cloud === null ? missing : entry.cloud.value,
        );
        const identity = { entityKind: entry.kind, entityId: entry.entityId };
        // Moving a workout across shards while another device edits it is a
        // structural conflict even if its individual scalar fields are disjoint.
        if (baselinePath !== devicePath || baselinePath !== cloudPath
            || !docPath.safe || !value.safe || (value.value === missing) !== (docPath.value === null)
            || !coherentBusiness(entry.kind, entry.entityId, docPath.value, value.value)) {
            return { ...identity, kind: 'manual-required' };
        }
        return { ...identity, kind: 'automatic-candidate',
            docPath: docPath.value as string | null,
            value: value.value === missing ? null : structuredClone(value.value),
        };
    });
}
