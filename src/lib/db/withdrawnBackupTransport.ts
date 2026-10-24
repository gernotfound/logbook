import { BACKEND_API_ORIGIN as API } from '../backendApi';
import { auth, ensureAppCheck } from '../firebase';
import { getLimitedUseAppCheckToken } from '../appCheck';
import type { DocumentData } from '../sync/documentProjection';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
type Page = { documents: Array<{ path: string; data: DocumentData }>; nextCursor: string | null; consentRevision: number };
type Section = 'root' | 'history_months' | 'nutrition_months';

/** An export-only API: no Admin credentials or revocation records in the browser. */
export async function fetchWithdrawnCloudBackup(uid: string, assertCurrent: () => void): Promise<Map<string, DocumentData>> {
  const user = auth.currentUser;
  if (!uid || !user || user.uid !== uid) throw new Error('Account cambiato durante esportazione.');
  await ensureAppCheck();
  assertCurrent();
  const documents = new Map<string, DocumentData>();
  let initialRevision: number | null = null;
  for (const section of ['root', 'history_months', 'nutrition_months'] as Section[]) {
    let after: string | null = null;
    const seen = new Set<string>();
    for (let pageNumber = 0; pageNumber < 5000; pageNumber++) {
      assertCurrent();
      const token = await getLimitedUseAppCheckToken();
      assertCurrent();
      const params = new URLSearchParams({ collection: section });
      if (after !== null) params.set('after', after);
      const response = await fetch(API + '/api/health-consent-export?' + params.toString(), {
        method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(12_000),
        headers: { authorization: 'Bearer ' + await user.getIdToken(), 'x-firebase-appcheck': token },
      });
      assertCurrent();
      if (!response.ok) throw new Error('Esportazione cloud non disponibile (HTTP ' + response.status + ').');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !Array.isArray((value as Partial<Page>).documents)) throw new Error('Pagina export non valida.');
      const result = value as Page;
      if (!Number.isSafeInteger(result.consentRevision) || result.consentRevision < 1
        || (initialRevision !== null && initialRevision !== result.consentRevision)) {
        throw new Error('La generazione di consenso è cambiata durante l’esportazione. Riprova.');
      }
      initialRevision = result.consentRevision;
      if (result.nextCursor !== null && (typeof result.nextCursor !== 'string' || !MONTH_RE.test(result.nextCursor) || seen.has(result.nextCursor))) throw new Error('Cursore export non valido.');
      for (const entry of result.documents) {
        if (!entry || (section === 'root' ? entry.path !== '' : !entry.path?.startsWith(section + '/'))
            || typeof entry.data !== 'object' || entry.data === null || Array.isArray(entry.data)
            || documents.has(entry.path)) throw new Error('Documento export non valido.');
        const monthId = section === 'root' ? '' : entry.path.slice(section.length + 1);
        if (section !== 'root' && !MONTH_RE.test(monthId)) throw new Error('Identificativo mese export non valido.');
        documents.set(entry.path, entry.data);
      }
      if (result.nextCursor === null) break;
      seen.add(result.nextCursor);
      after = result.nextCursor;
      if (pageNumber === 4999) throw new Error('Esportazione incompleta: troppe pagine.');
    }
  }
  // A destructive job can start after the last collection page. The separate
  // trusted checkpoint prevents claiming cloud completeness across that race.
  assertCurrent();
  const appCheckToken = await getLimitedUseAppCheckToken();
  assertCurrent();
  const idToken = await user.getIdToken();
  assertCurrent();
  const checkpoint = await fetch(API + '/api/health-consent-export?collection=checkpoint', {
    method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    headers: { authorization: 'Bearer ' + idToken, 'x-firebase-appcheck': appCheckToken },
  });
  assertCurrent();
  if (!checkpoint.ok) throw new Error('Impossibile verificare la completezza dell’esportazione.');
  const proof: unknown = await checkpoint.json();
  assertCurrent();
  if (!proof || typeof proof !== 'object' || (proof as Page).consentRevision !== initialRevision
    || initialRevision === null || !Array.isArray((proof as Page).documents)
    || (proof as Page).documents.length !== 0 || (proof as Page).nextCursor !== null) {
    throw new Error('Verifica finale dell’esportazione non valida.');
  }
  return documents;
}
