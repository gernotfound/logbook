import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { storeEncryptedTelemetry } from '../../src/lib/telemetry/secureQueueDevice';

/**
 * Exercise the supported persistent telemetry contract in integration tests.
 * Old plaintext localStorage queues are intentionally not a test seed.
 */
export async function seedCurrentTelemetryQueue(uid: string, items: unknown): Promise<void> {
  const owner = 'user:' + uid;
  await createAndMigrateVault(owner);
  const serialized = typeof items === 'string' ? items : JSON.stringify(items);
  if (!storeEncryptedTelemetry(owner, serialized)) {
    throw new Error('Unable to seed the authenticated telemetry queue for ' + owner);
  }
}
