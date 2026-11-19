import { KindeCandidateBoundaryError } from './kindeCandidateClient';

export interface KindeCandidatePreparedJson {
    url: string;
    filename: string;
    isCurrent: () => boolean;
    dispose: () => void;
}

/**
 * Preparation and browser download are distinct user actions. The scoped Blob
 * URL holds plaintext in memory only; it must not survive a revoked session
 * or an unmounted panel, and a click never proves that the file was saved.
 */
export function createKindeCandidatePreparedJson(
    file: { json: string; filename: string }, stillCurrent: () => boolean,
): KindeCandidatePreparedJson {
    if (!stillCurrent()) throw new KindeCandidateBoundaryError();
    const url = URL.createObjectURL(new Blob([file.json], {
        type: 'application/json;charset=utf-8',
    }));
    if (!stillCurrent()) {
        URL.revokeObjectURL(url);
        throw new KindeCandidateBoundaryError();
    }
    let disposed = false;
    return {
        url,
        filename: file.filename,
        isCurrent: () => !disposed && stillCurrent(),
        dispose: () => {
            if (disposed) return;
            disposed = true;
            URL.revokeObjectURL(url);
        },
    };
}
