import { captureSession, isCurrentSession } from '../sync/session';
import { readLocal } from '../sync/localRepository';
import { readStableDeviceRecovery } from '../backupDeviceSnapshot';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import type { BackupCoverage } from '../backup';

export { hasDeviceRecoveryBackupSource } from '../backupDeviceSnapshot';

// Device-only exports must never initialize the Firebase transport. The
// authenticated reader retains its own server consistency and ADK checks.
export async function collectBackupSnapshot(fallback: UserData, includeCloud: boolean, consistencyAttempt = 0, accountKey?: Uint8Array) {
    if (includeCloud) {
        const { collectBackupSnapshot: collectLegacySnapshot } = await import('./backupSnapshotLegacy');
        return collectLegacySnapshot(fallback, true, consistencyAttempt, accountKey);
    }

    const session = captureSession();
    const assertCurrent = () => {
        if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il backup.');
    };
    const envelope = await readLocal(session.owner);
    assertCurrent();
    // The strict inventory guards observable cross-tab witness changes even
    // when no durable envelope exists on this device.
    const device = readStableDeviceRecovery(session.owner);
    assertCurrent();
    const coverage: BackupCoverage = { scope: 'device', months: envelope?.completeMonths ?? [] };
    return {
        owner: session.owner,
        data: UserDataSchema.parse(envelope?.data ?? fallback) as unknown as UserData,
        coverage,
        recovery: { envelope, device, cloudDocuments: {} },
    };
}
