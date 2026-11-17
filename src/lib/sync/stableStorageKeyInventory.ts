/**
 * Cross-tab mutation can shift numeric localStorage indexes without removing
 * the relevant ciphertext. A stable membership check is required before a
 * destructive action or provisioning a replacement encryption key.
 *
 * This detects observable races only: localStorage has no atomic snapshot,
 * and an unseen ABA or a later legacy-tab write is still possible.
 */
export function stableStorageKeyInventory(changeMessage: string): Set<string> {
    const enumerate = (): Set<string> => {
        const count = localStorage.length;
        const keys = new Set<string>();
        for (let index = 0; index < count; index++) {
            const key = localStorage.key(index);
            if (key === null || keys.has(key)) throw new Error(changeMessage);
            keys.add(key);
        }
        if (localStorage.length !== count) throw new Error(changeMessage);
        return keys;
    };
    const first = enumerate();
    const second = enumerate();
    if (first.size !== second.size || [...first].some(key => !second.has(key))) {
        throw new Error(changeMessage);
    }
    return second;
}
