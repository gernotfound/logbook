/**
 * Utility to serialize plain JavaScript objects into Firestore REST API Document format.
 */

export function serializeForFirestore(data: any): any {
    if (data === null || data === undefined) {
        return { nullValue: null };
    }

    if (typeof data === 'boolean') {
        return { booleanValue: data };
    }

    if (typeof data === 'number') {
        if (Number.isInteger(data)) {
            return { integerValue: data.toString() };
        } else {
            return { doubleValue: data };
        }
    }

    if (typeof data === 'string') {
        return { stringValue: data };
    }

    if (Array.isArray(data)) {
        return {
            arrayValue: {
                values: data.map(item => serializeForFirestore(item))
            }
        };
    }

    if (typeof data === 'object') {
        const fields: Record<string, any> = {};
        for (const key of Object.keys(data)) {
            const val = data[key];
            if (val !== undefined) { // Firestore ignores undefined
                fields[key] = serializeForFirestore(val);
            }
        }
        return {
            mapValue: {
                fields
            }
        };
    }

    // Fallback for unknown types
    return { stringValue: String(data) };
}

/**
 * Wraps the serialized data into a Firestore Document object.
 */
export function wrapInFirestoreDocument(data: Record<string, any>): any {
    const fields: Record<string, any> = {};
    for (const key of Object.keys(data)) {
        const val = data[key];
        if (val !== undefined) {
            fields[key] = serializeForFirestore(val);
        }
    }
    return { fields };
}
