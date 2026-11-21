/**
 * Adversarial validator that recursively traverses a data structure
 * and asserts that NO property or element is `undefined`.
 * Checks arrays and plain-object payloads without using the production predicate.
 * This is not an SDK-level validator for arbitrary class instances.
 */
export function assertNoUndefined(value: unknown, path = 'root'): void {
    if (value === undefined) {
        throw new Error(`[FIRESTORE VIOLATION] Encountered 'undefined' at path: ${path}`);
    }
    if (value === null || typeof value !== 'object') {
        return;
    }
    if (Array.isArray(value)) {
        // forEach skips sparse holes, although Firestore-bound arrays must be dense.
        for (let index = 0; index < value.length; index++) {
            if (!Object.hasOwn(value, index) || value[index] === undefined) {
                throw new Error(`[FIRESTORE VIOLATION] Missing or undefined array item at path: ${path}[${index}]`);
            }
            assertNoUndefined(value[index], `${path}[${index}]`);
        }
        return;
    }
    // The serialization oracle must not call the production isPlainObject
    // predicate: a regression there could otherwise hide leaked undefined.
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
        for (const key of Object.keys(value)) {
            const val = (value as Record<string, any>)[key];
            if (val === undefined) {
                throw new Error(`[FIRESTORE VIOLATION] Encountered 'undefined' in object at path: ${path}.${key}`);
            }
            assertNoUndefined(val, `${path}.${key}`);
        }
    }
}

