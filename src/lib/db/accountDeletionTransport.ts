import { BACKEND_API_ORIGIN as ACCOUNT_DELETION_API_ORIGIN } from '../backendApi';
import { ensureAppCheck } from '../firebase';
import { assertDeletionDeadlineActive, withDeletionDeadline } from '../deletionDeadline';
import { type AccountDeletionMarker } from '../sync/accountGate';

// App Check and HTTP request/response boundary. Durable acknowledgement,
// owner validation and local cleanup remain with the account orchestrator.
export type ServerDeletionStatus = {
    uid: string;
    status: 'requested' | 'deleting' | 'verifying' | 'complete' | 'failed';
    attempts?: number;
    retryable?: boolean;
    error?: string;
};

export const ACCOUNT_DELETION_HTTP_TIMEOUT_MS = 7500;

export class AccountDeletionRequestTimeoutError extends Error {
    constructor() {
        super('Il server di cancellazione non ha risposto entro il limite interattivo.');
        this.name = 'AccountDeletionRequestTimeoutError';
    }
}

export class AccountDeletionReceiptNotFoundError extends Error {
    constructor(readonly uid?: string) {
        super('La ricevuta locale non è più riconosciuta dal server. La copia locale resta conservata fino alla verifica del dispositivo.');
        this.name = 'AccountDeletionReceiptNotFoundError';
    }
}

function accountDeletionUrl(): string {
    if (!ACCOUNT_DELETION_API_ORIGIN) throw new Error('Backend cancellazione account non configurato.');
    return ACCOUNT_DELETION_API_ORIGIN + '/api/account-deletion';
}

export async function appCheckToken(): Promise<string> {
    try {
        await ensureAppCheck();
        const { getLimitedUseAppCheckToken } = await import('../appCheck');
        const token = await getLimitedUseAppCheckToken();
        if (!token) throw new Error('Token App Check limited-use assente.');
        return token;
    } catch (error) {
        throw new Error('Verifica App Check non disponibile. Cancellazione non avviata.', { cause: error });
    }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
    try { return await response.json() as Record<string, unknown>; }
    catch { return {}; }
}

export async function requestServerDeletion(marker: AccountDeletionMarker, idToken: string, appToken: string): Promise<void> {
    const { response, body } = await withDeletionDeadline(async signal => {
        const response = await fetch(accountDeletionUrl(), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${idToken}`,
                'x-firebase-appcheck': appToken,
            },
            body: JSON.stringify({ receiptToken: marker.receiptToken }),
            cache: 'no-store',
            signal,
        });
        assertDeletionDeadlineActive(signal);
        const body = await readJson(response);
        assertDeletionDeadlineActive(signal);
        return { response, body };
    }, ACCOUNT_DELETION_HTTP_TIMEOUT_MS, () => new AccountDeletionRequestTimeoutError());
    if (!response.ok) {
        const message = typeof body.error === 'string' ? body.error : 'Impossibile avviare la cancellazione account.';
        const error = new Error(message) as Error & { definitiveRejection?: boolean };
        error.definitiveRejection = response.status === 400 || response.status === 401 || response.status === 403;
        throw error;
    }
}

export async function fetchAccountDeletionStatus(marker: AccountDeletionMarker, timeoutMs = ACCOUNT_DELETION_HTTP_TIMEOUT_MS): Promise<ServerDeletionStatus> {
    if (!marker.receiptToken) throw new Error('Cancellazione in sospeso senza ricevuta server. Riprendi l’operazione dalle impostazioni.');
    const { response, body } = await withDeletionDeadline(async signal => {
        const token = await appCheckToken();
        assertDeletionDeadlineActive(signal);
        const response = await fetch(accountDeletionUrl(), {
            method: 'GET',
            headers: {
                'x-firebase-appcheck': token,
                'x-account-deletion-uid': marker.uid,
                'x-account-deletion-receipt': marker.receiptToken!,
            },
            cache: 'no-store',
            signal,
        });
        assertDeletionDeadlineActive(signal);
        const body = await readJson(response);
        assertDeletionDeadlineActive(signal);
        return { response, body };
    }, timeoutMs, () => new AccountDeletionRequestTimeoutError());
    if (response.status === 404) throw new AccountDeletionReceiptNotFoundError(marker.uid);
    if (!response.ok) {
        throw new Error(typeof body.error === 'string'
            ? body.error
            : 'Impossibile verificare lo stato della cancellazione. Copia locale conservata.');
    }
    return body as unknown as ServerDeletionStatus;
}

