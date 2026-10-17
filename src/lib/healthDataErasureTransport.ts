import { BACKEND_API_ORIGIN as API } from './backendApi';

// HTTP response handling only: the caller verifies the owner, current session,
// server-complete proof and consent revision before any local purge.
export async function sendHealthDataErasure(
  method: 'POST' | 'GET',
  headers: { authorization: string; 'x-firebase-appcheck': string },
): Promise<unknown> {
  const response = await fetch(API + '/api/health-data-erasure', {
    method, cache: 'no-store', signal: AbortSignal.timeout(12000), headers,
  });
  if (method === 'GET' && !response.ok) {
    throw new Error('Non è stato possibile verificare la ricevuta della cancellazione cloud.');
  }
  const body: unknown = await response.json();
  if (method === 'POST' && !response.ok && response.status !== 202) {
    const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'Cancellazione non confermata dal servizio.';
    throw new Error(message);
  }
  return body;
}
