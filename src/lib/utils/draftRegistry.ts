type FlushCallback = () => void;

class DraftRegistry {
    private callbacks: Set<FlushCallback> = new Set();

    register(cb: FlushCallback) {
        this.callbacks.add(cb);
    }

    unregister(cb: FlushCallback) {
        this.callbacks.delete(cb);
    }

    flushAll(options: { strict?: boolean } = {}) {
        const errors: unknown[] = [];
        this.callbacks.forEach(cb => {
            try {
                cb();
            } catch (e) {
                errors.push(e);
                console.error("Error during flush:", e);
            }
        });
        if (options.strict && errors.length) throw new AggregateError(errors, 'Impossibile salvare tutte le bozze.');
    }
}

export const draftRegistry = new DraftRegistry();
