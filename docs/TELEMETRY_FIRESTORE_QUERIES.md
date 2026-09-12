# Guida operativa & consultazione telemetria Firestore (LogBook)

Questa guida illustra la struttura, le query, le regole di sicurezza e le procedure di troubleshooting per la consultazione degli errori e delle metriche PWA raccolte dall'Hub di Telemetria unificato di LogBook (`src/lib/telemetryHub.ts`), ora implementato e supportato tramite Web Worker.

---

## 1. Modello dati e struttura collezioni

La telemetria di LogBook è organizzata in subcollection sotto ogni documento utente autenticato (`users/{userId}`):

### 1.1 Errori globali (`users/{userId}/telemetry_errors/{errorId}`)
- **ID documento**: `err_${hash}` (hash esadecimale a 8 caratteri basato su algoritmo FNV-1a a 32-bit di `tipo:messaggio`).
- **Campi consentiti (whitelist)**:
  - `timestamp` (`number`): Timestamp Unix in millisecondi della prima rilevazione o dell'ultimo aggiornamento.
  - `type` (`string`): Classe o nome dell'errore (es. `TypeError`, `ZodError`, `SecurityError`, `ChunkLoadError`).
  - `message` (`string`): Messaggio di errore sanitizzato (completamente privo di PII).
  - `stack` (`string?`): Stack trace sanitizzato e troncato a max 1.000 caratteri (termina con `...[TRUNCATED]` se eccede).
  - `componentStack` (`string?`): Component stack di React 19 (se l'errore proviene da un render/boundary).
  - `source` (`string`): Origine dell'errore (`react_root`, `react_caught`, `react_uncaught`, `react_recoverable`, `window_error`, `unhandled_rejection`, `zod_validation`, `app_error`, `storage`, `custom`).
  - `context` (`map`):
    - `appVersion` (`string`): Versione dell'applicazione (es. `"1.0.0"`).
    - `platform` (`string`): Piattaforma derivata minimizzata (`"ios"`, `"ipados"`, `"other"`).
    - `displayMode` (`string`): Modalità di visualizzazione (`"standalone"` per PWA installata, `"browser"` per scheda web).
    - `online` (`boolean`): Stato di connettività al momento dell'evento.
  - `userId` (`string`): UID Firebase Auth dell'utente (o `'anonymous'` per guest locali).
  - `sessionId` (`string`): Identificatore di sessione univoco per scheda/avvio (`sess_${timestamp}_${random}`).
  - `count` (`number`): Numero totale di occorrenze aggregate nella finestra temporale di deduplicazione (60 secondi).
  - `firstSeen` (`number`): Timestamp Unix (ms) della prima occorrenza rilevata.
  - `lastSeen` (`number`): Timestamp Unix (ms) della più recente occorrenza rilevata.

### 1.2 Eventi e funnel PWA (`users/{userId}/telemetry_events/{eventId}`)
- **ID documento**: `evt_${timestamp}_${random}`.
- **Campi consentiti (whitelist)**:
  - `timestamp` (`number`): Timestamp Unix in millisecondi dell'evento.
  - `type` (`string`): Tipologia di evento (`pwa_install_impression`, `pwa_install_click`, `pwa_install_prompt_outcome`, `pwa_appinstalled`, `workout_started`, `workout_saved`, `storage_recovery_anomaly`, `zod_schema_fallback`, `custom_event`).
  - `context` (`map`): Contesto operativo (`appVersion`, `platform`, `displayMode`, `online`).
  - `userId` (`string`): UID Firebase Auth dell'utente.
  - `sessionId` (`string`): Identificatore di sessione.
  - `details` (`map?`): Metadati dell'evento privi di dati sensibili (es. `{ offline: true, durationMinutes: 45, outcome: "accepted" }`).

### 1.3 Anomalie di persistenza storage (`users/{userId}/telemetry_anomalies/{eventId}`)
- **ID documento**: `anomaly_${timestamp}_${random}`.
- **Campi consentiti**: `type`, `reason`, `timestamp`, `elapsedMs`, `platform`, `standalone`, `persisted`.

---

## 2. Esempi di query e ispezione (Firestore Console & SDK)

La telemetria può essere consultata sia su base singolo utente (Client SDK) che su base globale aggregata (Admin SDK / BigQuery).

### 2.1 Query su singolo utente (Client / Supporto)

```typescript
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from './firebase';

// Recupera gli ultimi 20 errori di un utente specifico
const errorsRef = collection(db, 'users', userId, 'telemetry_errors');
const recentErrorsQuery = query(errorsRef, orderBy('timestamp', 'desc'), limit(20));
const errorsSnapshot = await getDocs(recentErrorsQuery);

errorsSnapshot.forEach((doc) => {
  console.log(`[Errore ${doc.id}]`, doc.data());
});

// Recupera i crash React non gestiti per un utente
const uncaughtQuery = query(
  errorsRef,
  where('source', '==', 'react_uncaught'),
  orderBy('timestamp', 'desc')
);
const uncaughtSnapshot = await getDocs(uncaughtQuery);
```

### 2.2 Query globali Collection Group (Admin / DevOps)

Per eseguire analisi complessive su tutti gli utenti tramite Firebase Admin SDK o Google Cloud BigQuery:

```typescript
import { collectionGroup, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

// 1. Feed globale dei crash critici (React uncaught o window.onerror)
const crashFeedQuery = query(
  collectionGroup(db, 'telemetry_errors'),
  where('source', 'in', ['react_uncaught', 'window_error', 'unhandled_rejection']),
  orderBy('timestamp', 'desc'),
  limit(50)
);

// 2. Rilevazione errori ad alta frequenza (count >= 5)
const errorStormQuery = query(
  collectionGroup(db, 'telemetry_errors'),
  where('count', '>=', 5),
  orderBy('count', 'desc'),
  limit(25)
);

// 3. Distribuzione crash per piattaforma PWA su iOS
const iosPwaCrashesQuery = query(
  collectionGroup(db, 'telemetry_errors'),
  where('context.platform', '==', 'ios'),
  where('context.displayMode', '==', 'standalone'),
  orderBy('timestamp', 'desc')
);

// 4. Analisi funnel installazione PWA (ultimi 7 giorni)
const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

const impressionsQuery = query(
  collectionGroup(db, 'telemetry_events'),
  where('type', '==', 'pwa_install_impression'),
  where('timestamp', '>=', weekAgo)
);

const acceptedPromptQuery = query(
  collectionGroup(db, 'telemetry_events'),
  where('type', '==', 'pwa_install_prompt_outcome'),
  where('details.outcome', '==', 'accepted'),
  where('timestamp', '>=', weekAgo)
);

const appInstalledQuery = query(
  collectionGroup(db, 'telemetry_events'),
  where('type', '==', 'pwa_appinstalled'),
  where('timestamp', '>=', weekAgo)
);
```

---

## 3. Indici compositi Firestore (`firestore.indexes.json`)

Per abilitare l'esecuzione rapida delle query collection group sopra descritte senza errori di indicizzazione:

```json
{
  "indexes": [
    {
      "collectionGroup": "telemetry_errors",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "source", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "telemetry_errors",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "lastSeen", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "telemetry_errors",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "context.appVersion", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "telemetry_errors",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "context.platform", "order": "ASCENDING" },
        { "fieldPath": "context.displayMode", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "telemetry_errors",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "count", "order": "DESCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "telemetry_events",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "telemetry_events",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "details.offline", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "telemetry_events",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "details.outcome", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

---

## 4. Garanzie di privacy e sanitizzazione dati

Il motore di sanitizzazione (`src/lib/telemetrySanitizer.ts`) garantisce che nessun dato personale o sensibile lasci il dispositivo dell'utente:

1. **Zero PII**:
   - Indirizzi email $\rightarrow$ `[REDACTED_EMAIL]`.
   - Indirizzi IP (IPv4 e IPv6) $\rightarrow$ `[REDACTED_IP]`.
   - Bearer token, token JWT, chiavi API Firebase e password $\rightarrow$ `[REDACTED_TOKEN]` o `[REDACTED]`.
2. **Sanitizzazione percorsi file system**:
   - Percorsi Windows (`C:\Users\...`) e Unix (`/home/...`, `/Users/...`) $\rightarrow$ `[REDACTED_PATH]`.
3. **Troncamento stack trace**:
   - Stack trace e React component stack sono rigorosamente limitati a massimo 1.000 caratteri e terminano con `...[TRUNCATED]`.
4. **Zero dati di allenamento o biometrici**:
   - Non vengono mai inviati carichi, ripetizioni, note testuali, strutture di schede, alimenti o circonferenze corporee dell'utente.

---

## 5. Risoluzione problemi comuni (Troubleshooting)

### A. Errori in modalità Guest non visibili su Firestore
- **Causa**: Gli utenti in modalità guest operano senza sessione Firebase Auth per prevenire violazioni delle regole di sicurezza.
- **Funzionamento**: Gli errori e gli eventi vengono accodati nella memoria locale sincrona (`localStorage.getItem('logbook_telemetry_queue')`).
- **Risoluzione**: Quando l'utente effettua il login o collega un account Google (`linkGoogleAccount`), la coda viene automaticamente svuotata e sincronizzata con il nuovo UID autenticato.

### B. Errore `FirebaseError: [code=permission-denied]`
- **Causa**: Tentativo di scrittura di un payload contenente chiavi non ammesse dalla whitelist o con `userId` non corrispondente a `request.auth.uid`.
- **Risoluzione**: Verificare che l'oggetto inviato rispetti tassativamente le 12 chiavi consentite per `telemetry_errors` o le 6 chiavi per `telemetry_events`.

### C. Saturazione coda offline (Limite 50 elementi)
- **Causa**: Sessioni offline molto prolungate con accumulo di numerosi eventi.
- **Funzionamento**: Viene applicata una politica di espulsione FIFO rigorosa (i record più vecchi oltre il cinquantesimo vengono scartati per proteggere la quota di `localStorage`).
- **Risoluzione**: Alla prima riconnessione alla rete (`window.addEventListener('online')`), tutti gli eventi residui vengono inviati a Firestore in modo non bloccante.

### D. Deduplicazione e temporizzazione (Finestra 60s)
- **Causa**: Loop di rendering rapidi o errori ripetuti consecutivamente producono un unico documento Firestore.
- **Funzionamento**: Gli errori con identico hash `(tipo + messaggio)` aggiornano solo il contatore `count` e il timestamp `lastSeen` anziché creare nuovi documenti.
- **Risoluzione**: Consultare i campi `count`, `firstSeen` e `lastSeen` del documento per analizzare la frequenza e la persistenza dell'anomalia.

### E. Connessioni lente o timeout di rete (5.000ms)
- **Causa**: Connessioni mobili 2G/3G instabili.
- **Funzionamento**: I salvataggi Firestore sono protetti da un timeout di sicurezza di 5 secondi (`Promise.race`). In caso di timeout, l'invio non blocca l'interfaccia utente e il dato viene preservato nella coda offline locale.
