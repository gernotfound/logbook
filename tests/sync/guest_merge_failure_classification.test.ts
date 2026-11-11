import { beforeEach, describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../src/lib/schema';
import { mergeUserData } from '../../src/lib/merge';
import type { UserData } from '../../src/types';
import { classifySyncFailure } from '../../src/lib/sync/syncFailure';

const parse = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;

describe('Guest merge and cloud failure classification', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('preserves guest local-only conflicts during guest-to-account merge', () => {
        const cloud = parse({});
        const guest = parse({
            pendingConflicts: {
                nutritionPlanning: { onDaysCount: 4, normocalorica: { kcal: 2400 } },
            },
        });

        const merged = mergeUserData(cloud, guest);
        expect(merged.pendingConflicts?.nutritionPlanning).toMatchObject({ onDaysCount: 4, normocalorica: { kcal: 2400 } });
    });

    it('keeps App Check pending only when the provider failure is explicitly retryable', () => {
        const transient = Object.assign(new Error('App Check network unavailable'), {
            code: 'app-check-unavailable',
            retryable: true,
        });
        const structural = Object.assign(new Error('App Check unsupported'), {
            code: 'app-check-unavailable',
            retryable: false,
        });

        expect(classifySyncFailure(transient).status).toBe('local-pending');
        expect(classifySyncFailure(structural).status).toBe('failed');
    });
});
