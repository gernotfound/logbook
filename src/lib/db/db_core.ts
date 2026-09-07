export class SyncTimeoutError extends Error {
    constructor(message: string = "Timeout operazione Firestore") {
        super(message);
        this.name = "SyncTimeoutError";
    }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, errMsg = "Timeout operazione Firestore"): Promise<T> {
    let timer: any;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SyncTimeoutError(errMsg)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export let dbState = {
    lastSavedStateStr: null as string | null
};

export function setLastSavedStateStr(val: string | null) {
    dbState.lastSavedStateStr = val;
}
