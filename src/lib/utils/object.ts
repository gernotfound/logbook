/**
 * Object manipulation and sanitization utilities for LogBook.
 */

/**
 * Checks if a value is a plain JavaScript object (created via {} or Object.create(null)).
 * Custom class instances, Dates, RegExps, Firestore FieldValues, DocumentReferences, etc.,
 * return false so their prototype and instance methods are preserved.
 */
export function isPlainObject(value: unknown): value is Record<string, any> {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}

/**
 * Preserves dynamic keys as own enumerable data properties, without invoking
 * inherited setters such as "__proto__" on normal JavaScript objects.
 */
export function setOwnDataProperty<T>(target: Record<string, T>, key: string, value: T): void {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

/**
 * Removes undefined properties while preserving the historical non-throwing
 * behavior for circular references. This general-purpose helper is NOT a
 * Firestore serialization boundary: back-edges still refer to the source.
 */
export function removeUndefinedValues<T>(value: T, seen?: WeakSet<object>): T {
    return sanitizeUndefined(value, false, seen);
}

/**
 * Cleans a Firestore-bound payload and rejects cycles before the SDK sees it.
 * Shared but acyclic objects reuse their sanitized clone.
 */
export function removeUndefinedValuesForFirestore<T>(value: T): T {
    return sanitizeUndefined(value, true);
}

function sanitizeUndefined<T>(value: T, rejectCycles: boolean, seen?: WeakSet<object>): T {
    const active = seen ?? new WeakSet<object>();
    const copies = new WeakMap<object, unknown>();

    const sanitize = (current: unknown): unknown => {
        if (current === null || typeof current !== 'object') return current;
        if (!Array.isArray(current) && !isPlainObject(current)) return current;

        if (active.has(current)) {
            if (rejectCycles) throw new Error('Riferimento circolare nel payload Firestore');
            return current;
        }
        const previous = copies.get(current);
        if (previous) return previous;

        const copy: Record<string, unknown> | unknown[] = Array.isArray(current)
            ? new Array(current.length)
            : {};
        copies.set(current, copy);
        active.add(current);
        try {
            if (Array.isArray(current)) {
                for (let i = 0; i < current.length; i++) {
                    (copy as unknown[])[i] = current[i] === undefined ? null : sanitize(current[i]);
                }
            } else {
                for (const key of Object.keys(current)) {
                    const member = (current as Record<string, unknown>)[key];
                    if (member !== undefined) {
                        setOwnDataProperty(copy as Record<string, unknown>, key, sanitize(member));
                    }
                }
            }
        } finally {
            active.delete(current);
        }
        return copy;
    };

    return sanitize(value) as T;
}

import type { NutritionPlanning } from '../../types';

const NUTRITION_CONFLICT_FINGERPRINT_VERSION = 1;

/**
 * Generates a deterministic, versioned fingerprint for a NutritionPlanning object.
 *
 * Included fields:
 * - Scalars: weight, onDaysCount, notes, lockedMacro, chartPeriod, totalKcal
 * - Nested macro objects: avgMacros, onBoost, onMacros, offMacros, normocalorica
 * - Legacy fields: carbsPerKg, proPerKg, fatPerKg
 *
 * Excluded fields: Nessuno. Tutti i campi definiti dall'interfaccia NutritionPlanning sono
 * esplicitamente mappati. Questo assicura che qualsiasi modifica semantica al piano alteri
 * deterministicamente il fingerprint.
 */
export function getNutritionConflictFingerprint(plan: NutritionPlanning | null | undefined): string {
    if (!plan) return '';

    // Canonical serialization: explicitly map fields in a guaranteed order.
    // We use null to normalize undefined or missing values.
    const canonical = {
        weight: plan.weight ?? null,
        onDaysCount: plan.onDaysCount ?? null,
        notes: plan.notes ?? null,
        lockedMacro: plan.lockedMacro ?? null,
        chartPeriod: plan.chartPeriod ?? null,
        totalKcal: plan.totalKcal ?? null,

        avgMacros: plan.avgMacros ? {
            carbsPerKg: plan.avgMacros.carbsPerKg ?? null,
            proPerKg: plan.avgMacros.proPerKg ?? null,
            fatPerKg: plan.avgMacros.fatPerKg ?? null,
        } : null,

        onBoost: plan.onBoost ? {
            carbsPercent: plan.onBoost.carbsPercent ?? null,
            proPercent: plan.onBoost.proPercent ?? null,
            fatPercent: plan.onBoost.fatPercent ?? null,
        } : null,

        onMacros: plan.onMacros ? {
            carbsPerKg: plan.onMacros.carbsPerKg ?? null,
            proPerKg: plan.onMacros.proPerKg ?? null,
            fatPerKg: plan.onMacros.fatPerKg ?? null,
        } : null,

        offMacros: plan.offMacros ? {
            carbsPerKg: plan.offMacros.carbsPerKg ?? null,
            proPerKg: plan.offMacros.proPerKg ?? null,
            fatPerKg: plan.offMacros.fatPerKg ?? null,
        } : null,

        // Legacy fields for backward compatibility
        carbsPerKg: plan.carbsPerKg ?? null,
        proPerKg: plan.proPerKg ?? null,
        fatPerKg: plan.fatPerKg ?? null,
        normocalorica: plan.normocalorica ? {
            kcal: plan.normocalorica.kcal ?? null,
            carbs: plan.normocalorica.carbs ?? null,
            pro: plan.normocalorica.pro ?? null,
            fat: plan.normocalorica.fat ?? null,
        } : null,
    };

    return `v${NUTRITION_CONFLICT_FINGERPRINT_VERSION}:${JSON.stringify(canonical)}`;
}
