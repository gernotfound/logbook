import { readBrowserValueStrict, writeBrowserValue } from '../sync/browserStorage';
import { protectedDeviceKey } from '../sync/deviceStorage';
import { openLocalText, sealLocalText } from '../sync/secureArchiveCipher';
import { isVaultUnlocked, requireUnlockedLocalKey } from '../sync/secureArchiveSession';

/** Technical diagnostics are best-effort and never persisted as plaintext.
 * Before account/guest vault readiness they remain only in this tab's RAM.
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
  // Confirm the owner-scoped ciphertext is durable and authenticated before
  // reporting a successful best-effort persistence attempt.
  const stored = readBrowserValueStrict(key);
  if (stored !== ciphertext || openLocalText(secret, owner, key, stored) !== serialized) {
    return false;
  }
  return true;
}

