import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from '../sync/browserStorage';
import { deviceKey, protectedDeviceKey } from '../sync/deviceStorage';
import { openLocalText, sealLocalText } from '../sync/secureArchiveCipher';
import { isVaultUnlocked, requireUnlockedLocalKey } from '../sync/secureArchiveSession';

/** Technical diagnostics are best-effort, but never stored as new plaintext.
 * Before account/guest vault readiness they can remain in RAM for this tab.
 * An existing plaintext queue from an older build is sealed and read back
 * before its old owner-scoped copy is deleted.
 */
export function readEncryptedTelemetry(owner: string): string | null {
  if (!isVaultUnlocked(owner)) return null;
  const key = protectedDeviceKey('telemetry_queue', owner);
  const raw = readBrowserValueStrict(key);
  if (raw === null) return null;
  return openLocalText(requireUnlockedLocalKey(owner), owner, key, raw);
}

export function storeEncryptedTelemetry(owner: string, serialized: string): boolean {
  if (!isVaultUnlocked(owner)) return false;
  const key = protectedDeviceKey('telemetry_queue', owner);
  const secret = requireUnlockedLocalKey(owner);
  // A corrupt or incompatible sealed queue must not be overwritten just
  // because a best-effort read returned no usable events.
  const previous = readBrowserValueStrict(key);
  if (previous !== null) {
    const original = openLocalText(secret, owner, key, previous);
    if (!Array.isArray(JSON.parse(original))) return false;
  }
  const ciphertext = sealLocalText(secret, owner, key, serialized);
  writeBrowserValue(key, ciphertext);
  // Do not remove any plaintext left by an older tab unless the new copy
  // was durably written and successfully authenticated.
  const stored = readBrowserValueStrict(key);
  if (stored !== ciphertext || openLocalText(secret, owner, key, stored) !== serialized) {
    return false;
  }
  removeBrowserValue(deviceKey('telemetry_queue', owner));
  return true;
}

export function discardLegacyUnscopedTelemetry(): void {
  // Legacy global queue is never an owner authorization source after migration.
  removeBrowserValue('logbook_telemetry_queue');
}
