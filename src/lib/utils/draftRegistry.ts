type FlushCallback = () => void;

class DraftRegistry {
    private callbacks: Set<FlushCallback> = new Set();

    register(cb: FlushCallback) {
        this.callbacks.add(cb);
    }

    unregister(cb: FlushCallback) {
        this.callbacks.delete(cb);
    }

    flushAll() {
        this.callbacks.forEach(cb => {
            try {
                cb();
            } catch (e) {
                console.error("Error during flush:", e);
            }
        });
    }
}

export const draftRegistry = new DraftRegistry();
