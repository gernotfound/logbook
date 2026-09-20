import { storageOwner } from './session';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;
export function readDeviceValue(name: string, owner?: string): string | null {
    try {
        const resolvedOwner = owner ?? storageOwner();
        return localStorage.getItem(deviceKey(name, resolvedOwner));
    } catch (error) {
        console.warn('Archivio del dispositivo non leggibile:', error);
        return null;
    }
}
export function writeDeviceValue(name: string, value: string | null, owner?: string): void {
    // Callers decide the UI feedback; failure must not be mistaken for a successful save.
    const resolvedOwner = owner ?? storageOwner();
    if (value === null) localStorage.removeItem(deviceKey(name, resolvedOwner));
    else localStorage.setItem(deviceKey(name, resolvedOwner), value);
}
