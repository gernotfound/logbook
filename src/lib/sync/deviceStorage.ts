import { storageOwner } from './session';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;
export function readDeviceValue(name: string, owner = storageOwner()): string | null {
    try { return localStorage.getItem(deviceKey(name, owner)); }
    catch (error) { console.warn('Archivio del dispositivo non leggibile:', error); return null; }
}
export function writeDeviceValue(name: string, value: string | null, owner = storageOwner()): void {
    // Callers decide the UI feedback; failure must not be mistaken for a successful save.
    if (value === null) localStorage.removeItem(deviceKey(name, owner));
    else localStorage.setItem(deviceKey(name, owner), value);
}
