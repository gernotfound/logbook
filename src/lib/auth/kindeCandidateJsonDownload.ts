import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError } from './kindeCandidateClient';

/**
 * The click is an explicit browser download request, not proof that the
 * operating system saved the JSON. This helper never persists the plaintext.
 */
export async function requestKindeCandidateJsonDownload({
    stillCurrent, browserCookies, prepare,
}: {
    stillCurrent: () => boolean;
    browserCookies: () => string;
    prepare: (current: () => boolean) => Promise<{ filename: string; json: string }>;
}): Promise<void> {
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const result = await prepare(fence.stillCurrent);
    if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
    const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
        if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        try {
            if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
            link.click();
        } finally {
            link.remove();
        }
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
