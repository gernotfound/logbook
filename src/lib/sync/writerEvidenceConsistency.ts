import { readDeviceValueStrict } from './deviceStorage';
import { readDeviceConsentRevision } from './workoutDeviceIntent';

type WriterImage = { name: string; raw: string };

/**
 * A stable list of keys alone cannot prove a stable recovery snapshot:
 * another tab can replace a witness without changing membership, or advance
 * consent during the final authenticated reads. Keep all three guards together.
 */
export function assertStableWriterEvidence(
    owner: string,
    names: ReadonlySet<string>,
    consentRevision: number | undefined,
    scanned: readonly WriterImage[],
    readNames: () => ReadonlySet<string>,
    messages: { inventory: string; value: string },
): void {
    const after = readNames();
    if (after.size !== names.size || [...names].some(name => !after.has(name))
        || readDeviceConsentRevision(owner) !== consentRevision) {
        throw new Error(messages.inventory);
    }
    for (const witness of scanned) {
        if (readDeviceValueStrict(witness.name, owner) !== witness.raw) {
            throw new Error(messages.value);
        }
    }
    // Another tab can add a witness during the authenticated reads above.
    // Recheck membership after them; this is not an atomic cross-tab snapshot.
    const finalNames = readNames();
    if (finalNames.size !== names.size || [...names].some(name => !finalNames.has(name))
        || readDeviceConsentRevision(owner) !== consentRevision) {
        throw new Error(messages.inventory);
    }
}
