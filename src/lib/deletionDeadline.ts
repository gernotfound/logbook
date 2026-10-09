/**
 * Deadline for the complete request, including token providers and body parsing.
 * Abort is best effort: late continuations must check the signal before side effects.
 */
class DeletionDeadlineExceededError extends Error {
    constructor() {
        super('La verifica della cancellazione non ha risposto entro il limite previsto.');
        this.name = 'DeletionDeadlineExceededError';
    }
}

export function assertDeletionDeadlineActive(signal: AbortSignal): void {
    if (signal.aborted) throw new DeletionDeadlineExceededError();
}

export async function withDeletionDeadline<T>(
    task: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    timeoutError: () => Error = () => new DeletionDeadlineExceededError(),
): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(timeoutError());
            controller.abort();
        }, Math.max(1, timeoutMs));
    });
    try {
        return await Promise.race([task(controller.signal), timeout]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
