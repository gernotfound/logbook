import { storageOwner } from './session';

/** Owner-scoped storage identifiers have no consent, network or provider side effects. */
export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;

/** Protected device records never alias plaintext names from suspended tabs. */
export const protectedDeviceKey = (name: string, owner = storageOwner()) => {
    if (!name || name.startsWith('sealed:')) throw new Error('Chiave dispositivo protetta non valida.');
    return deviceKey('sealed:' + name, owner);
};
