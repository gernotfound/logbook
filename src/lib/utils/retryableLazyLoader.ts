export function createRetryableLazyLoader<T>(load: () => Promise<T>): () => Promise<T> {
    let pending: Promise<T> | null = null;

    return () => {
        if (!pending) {
            pending = load().catch(error => {
                pending = null;
                throw error;
            });
        }
        return pending;
    };
}
