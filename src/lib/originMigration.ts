import { auth } from './firebase';
import {
  originMigrationSource,
  originMigrationTarget,
} from './deploymentConfig';
import {
  readBrowserValueStrict,
  removeBrowserValue,
  writeBrowserValue,
} from './sync/browserStorage';
import {
  installTransferredLocalEnvelope,
  readLocal,
  type LocalEnvelope,
} from './sync/localRepository';
import { normalizeStorageOwner, userOwner } from './sync/owner';
import { findPendingAccountDeletion } from './sync/accountGate';

const QUERY_MODE = 'logbookMigration';
const QUERY_TARGET = 'target';
const QUERY_NONCE = 'nonce';
const MESSAGE_TYPE = 'logbook:origin-migration:v1';
const DECISION_KEY = 'logbook_origin_migration_decision_v1';
const PENDING_UID_KEY = 'logbook_origin_migration_pending_uid_v1';
const INSTALLING_OWNER_KEY = 'logbook_origin_migration_installing_owner_v1';
const GUEST_MIGRATION_RECOVERY_KEY = 'logbook_guest_migration_sync_recovery';

const NONCE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const DEVICE_NAME_RE = /^[A-Za-z0-9:_-]{1,96}$/;

export interface OriginMigrationPayloadV1 {
  version: 1;
  sourceOrigin: string;
  owner: string;
  exportedAt: string;
  envelope: LocalEnvelope;
  device: Record<string, string>;
}

type OriginMigrationMessage =
  | { type: typeof MESSAGE_TYPE; nonce: string; ok: true; payload: OriginMigrationPayloadV1 }
  | { type: typeof MESSAGE_TYPE; nonce: string; ok: false; error: string };

function currentOrigin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function devicePrefix(owner: string): string {
  return `logbook:v2:${owner}:`;
}

function collectDeviceState(owner: string): Record<string, string> {
  const result: Record<string, string> = {};
  const prefix = devicePrefix(owner);
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const name = key.slice(prefix.length);
    if (!DEVICE_NAME_RE.test(name)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) result[name] = value;
  }
  return result;
}

async function sourceOwner(): Promise<string | null> {
  if (typeof auth.authStateReady === 'function') await auth.authStateReady();

  const guest = readBrowserValueStrict('logbook_is_guest') === 'true';
  if (guest) return 'guest';

  const uid = auth.currentUser?.uid;
  if (uid) return userOwner(uid);

  // Firebase Auth may already be gone while the local receipt/envelope still
  // has to finish the server-mediated deletion recovery. Preserve that owner
  // across the hosting-origin cutover as well.
  return findPendingAccountDeletion()?.owner ?? null;
}

function safeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Trasferimento dati non disponibile.';
}

function renderBridgeStatus(message: string): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';
  const main = document.createElement('main');
  main.setAttribute('role', 'status');
  main.style.cssText = 'min-height:100dvh;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif;background:#000;color:#fff;text-align:center';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:520px';
  const title = document.createElement('h1');
  title.textContent = 'LogBook';
  const text = document.createElement('p');
  text.textContent = message;
  box.append(title, text);
  main.append(box);
  root.append(main);
}

export async function handleOriginMigrationExportRequest(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const source = originMigrationSource();
  const target = originMigrationTarget();
  if (!source || !target || currentOrigin() !== source) return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get(QUERY_MODE) !== 'export') return false;

  renderBridgeStatus('Preparazione del trasferimento dati…');

  const nonce = params.get(QUERY_NONCE) ?? '';
  const requestedTarget = params.get(QUERY_TARGET) ?? '';

  const fail = (message: string) => {
    const response: OriginMigrationMessage = { type: MESSAGE_TYPE, nonce, ok: false, error: message };
    if (window.opener) window.opener.postMessage(response, target);
    renderBridgeStatus(message);
  };

  if (!window.opener) {
    fail('Trasferimento non avviato correttamente. Torna al nuovo indirizzo LogBook e riprova.');
    return true;
  }
  if (!NONCE_RE.test(nonce) || requestedTarget !== target) {
    fail('Richiesta di trasferimento non valida.');
    return true;
  }

  try {
    const recoveryUid = readBrowserValueStrict(GUEST_MIGRATION_RECOVERY_KEY);
    if (recoveryUid) {
      throw new Error('Completa prima la sincronizzazione dell’account sul vecchio LogBook, poi ripeti il trasferimento.');
    }

    const owner = await sourceOwner();
    if (!owner) {
      throw new Error('Sul vecchio indirizzo non risulta una sessione o una modalità locale da trasferire.');
    }

    const envelope = await readLocal(owner);
    if (!envelope) {
      throw new Error('Sul vecchio indirizzo non è stata trovata una copia locale da trasferire.');
    }

    const payload: OriginMigrationPayloadV1 = {
      version: 1,
      sourceOrigin: source,
      owner,
      exportedAt: new Date().toISOString(),
      envelope,
      device: collectDeviceState(owner),
    };
    const response: OriginMigrationMessage = { type: MESSAGE_TYPE, nonce, ok: true, payload };
    window.opener.postMessage(response, target);
    renderBridgeStatus('Dati inviati al nuovo LogBook. Puoi chiudere questa finestra.');
    setTimeout(() => window.close(), 750);
  } catch (error) {
    fail(safeError(error));
  }

  return true;
}

function validatePayload(value: unknown, expectedSource: string): OriginMigrationPayloadV1 {
  if (!value || typeof value !== 'object') throw new Error('Trasferimento origine: payload non valido.');
  const raw = value as Partial<OriginMigrationPayloadV1>;
  if (raw.version !== 1 || raw.sourceOrigin !== expectedSource) {
    throw new Error('Trasferimento origine: versione o origine non valida.');
  }

  const owner = normalizeStorageOwner(String(raw.owner ?? ''));
  if (!raw.envelope || typeof raw.envelope !== 'object') {
    throw new Error('Trasferimento origine: archivio mancante.');
  }
  if (!raw.device || typeof raw.device !== 'object' || Array.isArray(raw.device)) {
    throw new Error('Trasferimento origine: stato dispositivo non valido.');
  }

  const device: Record<string, string> = {};
  for (const [name, item] of Object.entries(raw.device)) {
    if (!DEVICE_NAME_RE.test(name) || typeof item !== 'string') {
      throw new Error('Trasferimento origine: chiave dispositivo non valida.');
    }
    device[name] = item;
  }

  return {
    version: 1,
    sourceOrigin: expectedSource,
    owner,
    exportedAt: String(raw.exportedAt ?? ''),
    envelope: raw.envelope as LocalEnvelope,
    device,
  };
}

export async function installOriginMigrationPayload(value: unknown): Promise<{ owner: string }> {
  const source = originMigrationSource();
  const target = originMigrationTarget();
  if (!source || !target || currentOrigin() !== target) {
    throw new Error('Trasferimento origine non disponibile su questo indirizzo.');
  }

  const payload = validatePayload(value, source);

  if (typeof auth.authStateReady === 'function') await auth.authStateReady();
  const targetUid = auth.currentUser?.uid ?? null;
  const targetGuest = readBrowserValueStrict('logbook_is_guest') === 'true';
  if (payload.owner !== 'guest' && targetGuest) {
    throw new Error('Sul nuovo indirizzo è già attiva la modalità locale. Esci dalla modalità locale prima di trasferire i dati di un account.');
  }
  if (payload.owner === 'guest' && targetUid) {
    throw new Error('Sul nuovo indirizzo è già attivo un account. Esci prima di trasferire i dati della modalità locale.');
  }
  if (payload.owner.startsWith('user:') && targetUid && userOwner(targetUid) !== payload.owner) {
    throw new Error('Sul nuovo indirizzo è attivo un account diverso da quello dei dati da trasferire.');
  }

  const prefix = devicePrefix(payload.owner);
  const incomingUid = payload.owner.startsWith('user:') ? payload.owner.slice('user:'.length) : null;
  const existingPendingUid = readBrowserValueStrict(PENDING_UID_KEY);
  if (existingPendingUid && existingPendingUid !== incomingUid) {
    throw new Error('Trasferimento bloccato: sul nuovo indirizzo esistono dati trasferiti per un altro account.');
  }

  const installingOwner = readBrowserValueStrict(INSTALLING_OWNER_KEY);
  if (installingOwner && installingOwner !== payload.owner) {
    throw new Error('Trasferimento bloccato: sul nuovo indirizzo esiste un trasferimento incompleto per un altro archivio.');
  }

  // Target-only device keys are divergent state too. Leaving one behind (for
  // example an active workout or deletion receipt) could resurrect stale state
  // after the envelope transfer. Exact matches remain valid for idempotent retry.
  const existingDevice = collectDeviceState(payload.owner);
  for (const [name, current] of Object.entries(existingDevice)) {
    if (!Object.hasOwn(payload.device, name) || payload.device[name] !== current) {
      throw new Error('Trasferimento bloccato: sul nuovo indirizzo esistono già dati dispositivo diversi.');
    }
  }

  // Preflight every incoming localStorage key before the IndexedDB install. A retry can
  // continue only when existing values are identical; divergent target state is
  // never overwritten automatically.
  for (const [name, incoming] of Object.entries(payload.device)) {
    const key = prefix + name;
    const current = readBrowserValueStrict(key);
    if (current !== null && current !== incoming) {
      throw new Error('Trasferimento bloccato: sul nuovo indirizzo esistono già dati dispositivo diversi.');
    }
  }

  // IndexedDB and localStorage cannot participate in one browser transaction.
  // Persist a strict install fence before the first cross-storage mutation so a
  // quota/security failure after the envelope commit cannot be mistaken for a
  // clean state that is safe to skip. Exact-owner retries remain idempotent.
  let envelopeInstalled = false;
  writeBrowserValue(INSTALLING_OWNER_KEY, payload.owner);
  try {
    await installTransferredLocalEnvelope(payload.owner, payload.envelope);
    envelopeInstalled = true;

    for (const [name, incoming] of Object.entries(payload.device)) {
      writeBrowserValue(prefix + name, incoming);
    }

    if (payload.owner === 'guest') {
      writeBrowserValue('logbook_is_guest', 'true');
    } else {
      writeBrowserValue(PENDING_UID_KEY, payload.owner.slice('user:'.length));
    }
    writeBrowserValue(DECISION_KEY, 'completed');
  } catch (error) {
    // If IndexedDB never accepted the envelope, no business-data transfer was
    // committed and the fence can be removed. After an envelope commit the
    // fence must survive until an idempotent retry completes every storage step.
    if (!envelopeInstalled) {
      try {
        removeBrowserValue(INSTALLING_OWNER_KEY);
      } catch {
        // Storage is already unhealthy; leaving the fence is the safer state.
      }
    }
    throw error;
  }

  // Completion is already durable. A cleanup failure must not turn a completed
  // transfer into a retry loop; shouldOfferOriginMigration() keys off DECISION_KEY.
  try {
    removeBrowserValue(INSTALLING_OWNER_KEY);
  } catch {
    // Best-effort cleanup of a recovery fence after durable completion.
  }

  return { owner: payload.owner };
}

export function shouldOfferOriginMigration(): boolean {
  if (typeof window === 'undefined') return false;
  const source = originMigrationSource();
  const target = originMigrationTarget();
  if (!source || !target || currentOrigin() !== target || source === target) return false;
  try {
    return readBrowserValueStrict(DECISION_KEY) === null;
  } catch {
    // A migration decision is a lifecycle gate: unreadable storage must not be
    // mistaken for "already handled".
    return true;
  }
}

export function skipOriginMigration(): void {
  const decision = readBrowserValueStrict(DECISION_KEY);
  if (decision === 'completed') return;

  if (readBrowserValueStrict(INSTALLING_OWNER_KEY) !== null) {
    throw new Error('Il trasferimento precedente è incompleto. Riprova il trasferimento prima di continuare senza importare.');
  }

  writeBrowserValue(DECISION_KEY, 'skipped');
}

export function originMigrationPendingUid(): string | null {
  try {
    return readBrowserValueStrict(PENDING_UID_KEY);
  } catch {
    return null;
  }
}

export function clearOriginMigrationPendingUid(uid: string): void {
  if (originMigrationPendingUid() === uid) {
    removeBrowserValue(PENDING_UID_KEY);
  }
}

export async function requestOriginMigration(): Promise<void> {
  const source = originMigrationSource();
  const target = originMigrationTarget();
  if (!source || !target || currentOrigin() !== target) {
    throw new Error('Trasferimento dal vecchio indirizzo non configurato.');
  }
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Generatore sicuro non disponibile.');
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const nonce = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  const url = new URL(source);
  url.searchParams.set(QUERY_MODE, 'export');
  url.searchParams.set(QUERY_TARGET, target);
  url.searchParams.set(QUERY_NONCE, nonce);

  const popup = window.open(url.toString(), 'logbook-origin-migration', 'popup,width=520,height=720');
  if (!popup) throw new Error('Il browser ha bloccato la finestra di trasferimento. Consenti i popup per LogBook e riprova.');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Il vecchio LogBook non ha risposto. Aprilo, assicurati che sia aggiornato e riprova.'));
    }, 30_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent) => {
      if (settled || event.origin !== source || event.source !== popup) return;
      const data = event.data as Partial<OriginMigrationMessage> | null;
      if (!data || data.type !== MESSAGE_TYPE || data.nonce !== nonce) return;

      settled = true;
      cleanup();

      if (data.ok !== true) {
        const failure = data as Partial<Extract<OriginMigrationMessage, { ok: false }>>;
        reject(new Error(typeof failure.error === 'string' ? failure.error : 'Trasferimento non riuscito.'));
        return;
      }

      const success = data as Partial<Extract<OriginMigrationMessage, { ok: true }>>;
      installOriginMigrationPayload(success.payload)
        .then(() => resolve())
        .catch(reject);
    };

    window.addEventListener('message', onMessage);
  });
}
