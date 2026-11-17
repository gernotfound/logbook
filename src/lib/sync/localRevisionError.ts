export class StaleLocalRevisionError extends Error {
    readonly code = 'stale-local-revision';

    constructor(readonly expectedRevision: number, readonly actualRevision: number | null) {
        super('I dati locali sono cambiati durante l’operazione. Ripeti l’anteprima.');
        this.name = 'StaleLocalRevisionError';
    }
}
