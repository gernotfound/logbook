import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { DB } from '../src/lib/db';

vi.mock('firebase/firestore', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as object),
        waitForPendingWrites: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves so we can check pending state
    };
});

vi.mock('../src/lib/telemetry', () => ({
    telemetryHub: { trackError: vi.fn() }
}));

describe('ARCH-02: createSyncSlice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        
        useAppStore.setState({
            userData: {
                profile: {},
                library: [],
                routines: [],
                customFoods: [],
                history: [],
                nutrition: {},
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: [],
                activePains: [],
                catalogOverrides: {},
                legalConsent: null
            },
            syncing: false,
            saveError: null
        });
    });

    it('should reject with Error when DB returns rejected', async () => {
        vi.mocked(DB.saveUserData).mockResolvedValueOnce({ ok: false, status: 'rejected', error: { code: 'permission-denied' } });
        
        const promise = useAppStore.getState().updateUserData((prev) => ({ ...prev, profile: { ...prev.profile, height: '180' } }));
        
        // Attach rejection handler BEFORE running timers to avoid PromiseRejectionHandledWarning
        const expectation = expect(promise).rejects.toThrow("Sincronizzazione rifiutata dal server");
        await vi.runAllTimersAsync();
        await expectation;
        
        const state = useAppStore.getState();
        expect(state.saveError).toBe("Sincronizzazione rifiutata dal server. Verifica l'accesso e riprova.");
    });
    
    it('should resolve with local-pending SyncResult when DB returns local-pending', async () => {
        vi.mocked(DB.saveUserData).mockResolvedValueOnce({ ok: false, status: 'local-pending', error: { code: 'unavailable' } });
        
        const promise = useAppStore.getState().updateUserData((prev) => ({ ...prev, profile: { ...prev.profile, height: '180' } }));
        
        await vi.runAllTimersAsync();
        const result = await promise;
        
        expect(result.ok).toBe(false);
        expect(result.status).toBe('local-pending');
        
        const state = useAppStore.getState();
        expect(state.saveError).toBe('Salvato localmente. Sincronizzazione in attesa.');
    });
    
    it('should resolve with synced SyncResult on success', async () => {
        vi.mocked(DB.saveUserData).mockResolvedValueOnce({ ok: true, status: 'synced' });
        
        const promise = useAppStore.getState().updateUserData((prev) => ({ ...prev, profile: { ...prev.profile, height: '180' } }));
        
        await vi.runAllTimersAsync();
        const result = await promise;
        
        expect(result.ok).toBe(true);
        expect(result.status).toBe('synced');
        
        const state = useAppStore.getState();
        expect(state.saveError).toBeNull();
    });
});
