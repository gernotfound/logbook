import { readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { readDeviceConsentRevision } from './workoutDeviceIntent';

export type DatedDraftStorage = {
    read: (name: string) => string | null;
    write: (name: string, value: string | null, observed: string | null) => void;
    readRevision: () => number | undefined;
};

export function ordinaryDatedDraftStorage(owner: string): DatedDraftStorage {
    return {
        read: name => readDeviceValueStrict(name, owner),
        write: (name, value) => writeDeviceValue(name, value, owner),
        readRevision: () => readDeviceConsentRevision(owner),
    };
}
