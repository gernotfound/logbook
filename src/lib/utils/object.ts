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
 * Recursively sanitizes data structures by removing properties with `undefined` values.
 * Designed for Firestore payloads to avoid "Unsupported field value: undefined" errors
 * without the CPU and GC overhead of JSON.parse(JSON.stringify(...)).
 * 
 * - Primitives (strings, numbers, booleans, null) are returned as-is.
 * - In plain objects, keys with `undefined` values are omitted entirely.
 * - In arrays, elements are recursively cleaned; `undefined` elements are converted to `null`.
 * - Non-plain objects (Date, Firestore FieldValue, RegExp, Blob, etc.) are preserved intact.
 * - Defends against circular references using a WeakSet.
 * 
 * @param value The value or data structure to sanitize.
 * @param seen Internal tracker to prevent infinite loops on circular references.
 * @returns A sanitized clone of the input with no `undefined` properties.
 */
export function removeUndefinedValues<T>(value: T, seen?: WeakSet<object>): T {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    // Guard against circular references
    const visited = seen || new WeakSet<object>();
    if (visited.has(value)) {
        return value;
    }
    visited.add(value);

    // Arrays: recursively sanitize each element
    if (Array.isArray(value)) {
        const len = value.length;
        const result = new Array(len);
        for (let i = 0; i < len; i++) {
            const item = value[i];
            result[i] = item === undefined ? null : removeUndefinedValues(item, visited);
        }
        return result as unknown as T;
    }

    // Plain objects: omit undefined keys and recursively sanitize defined values
    if (isPlainObject(value)) {
        const result: Record<string, any> = {};
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const val = (value as Record<string, any>)[key];
            if (val !== undefined) {
                result[key] = removeUndefinedValues(val, visited);
            }
        }
        return result as unknown as T;
    }

    // Non-plain objects (Date, FieldValue, RegExp, Blob, DocumentReference, etc.)
    return value;
}
