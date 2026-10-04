import { readBrowserValue, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { storageOwner } from './session';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;
export function readDeviceValue(name: string, owner?: string): string | null {
    try {
        const resolvedOwner = owner ?? storageOwner();
        return readBrowserValue(deviceKey(name, resolvedOwner));
    } catch {
        return null;
    }
}
export function writeDeviceValue(name: string, value: string | null, owner?: string): void {
    // Callers decide the UI feedback; failure must not be mistaken for a successful save.
    const resolvedOwner = owner ?? storageOwner();
    const key = deviceKey(name, resolvedOwner);
    if (value === null) removeBrowserValue(key);
    else writeBrowserValue(key, value);
}
