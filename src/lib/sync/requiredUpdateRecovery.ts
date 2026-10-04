type RecoveryCallback = () => void;

class RequiredUpdateRecoveryRegistry {
    private callbacks = new Set<RecoveryCallback>();

    register(callback: RecoveryCallback) {
        this.callbacks.add(callback);
        return () => this.callbacks.delete(callback);
    }

    captureAll() {
        const errors: unknown[] = [];
        this.callbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                errors.push(error);
            }
        });
        if (errors.length) {
            throw new AggregateError(
                errors,
                'Impossibile mettere al sicuro tutte le modifiche ancora presenti nell’interfaccia.',
            );
        }
    }
}

export const requiredUpdateRecoveryRegistry = new RequiredUpdateRecoveryRegistry();
