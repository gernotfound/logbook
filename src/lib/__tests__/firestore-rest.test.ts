import { describe, it, expect } from 'vitest';
import { serializeForFirestore, wrapInFirestoreDocument } from '../firestore-rest';

describe('serializeForFirestore', () => {
    it('should serialize basic types correctly', () => {
        expect(serializeForFirestore('hello')).toEqual({ stringValue: 'hello' });
        expect(serializeForFirestore(42)).toEqual({ integerValue: '42' });
        expect(serializeForFirestore(3.14)).toEqual({ doubleValue: 3.14 });
        expect(serializeForFirestore(true)).toEqual({ booleanValue: true });
        expect(serializeForFirestore(null)).toEqual({ nullValue: null });
    });

    it('should serialize arrays correctly', () => {
        const arr = [1, 'two'];
        expect(serializeForFirestore(arr)).toEqual({
            arrayValue: {
                values: [
                    { integerValue: '1' },
                    { stringValue: 'two' }
                ]
            }
        });
    });

    it('should serialize objects correctly', () => {
        const obj = { name: 'Test', age: 30 };
        expect(serializeForFirestore(obj)).toEqual({
            mapValue: {
                fields: {
                    name: { stringValue: 'Test' },
                    age: { integerValue: '30' }
                }
            }
        });
    });

    it('should wrap in document format', () => {
        const doc = wrapInFirestoreDocument({ name: 'Test' });
        expect(doc).toEqual({
            fields: {
                name: { stringValue: 'Test' }
            }
        });
    });
});
