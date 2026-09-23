# Telemetria Firestore — guida operativa LogBook

> Stato: guida tecnica stabile | Ultima verifica: 2026-09-23 | Fonti eseguibili: `src/lib/telemetry/`, `src/lib/telemetrySanitizer.ts`, `src/hooks/usePWAInstall.ts`, `src/hooks/useWorkoutSession.ts`, `firestore.rules`.

Questa guida descrive la telemetria tecnica proprietaria di LogBook. Non va confusa con Vercel Analytics o Speed Insights, che sono sistemi separati e subordinati all'opt-in Analytics dell'utente. Google/Firebase Analytics non viene utilizzato.

## Modello dati

La telemetria cloud è owner-scoped sotto l'utente Firebase autenticato:

- `users/{uid}/telemetry_errors/{errorId}` — errori deduplicati;
- `users/{uid}/telemetry_events/{eventId}` — eventi tecnici/operativi;
- `users/{uid}/telemetry_anomalies/{eventId}` — anomalie di persistenza specifiche.

Il payload cloud include l'UID tecnico dell'utente autenticato e un `sessionId`. Per questo la telemetria **non è anonima**: è pseudonimizzata e tecnicamente collegabile all'account.

### Errori

Gli errori possono includere:

- timestamp;
- tipo, messaggio e source;
- contesto tecnico (`appVersion`, piattaforma derivata, display mode, stato online);
- UID e session ID;
- contatori `count`, `firstSeen`, `lastSeen`;
- stack/component stack sanitizzati e limitati a 1.000 caratteri.

La versione applicativa viene dal build-time `__APP_VERSION__`; non deve essere mantenuta con un valore hardcoded separato.

### Eventi

Gli eventi di produzione della telemetria proprietaria sono riservati a diagnostica, integrità e recovery. I dettagli tecnici restano bounded da un'allowlist applicativa e dalle Security Rules; esempi correnti sono i metadati di fallback Zod (schema, field path, issue code e tipi atteso/ricevuto) e le anomalie di persistenza.

**MUST:** i flussi di utilizzo ordinario non emettono telemetria proprietaria comportamentale. In particolare `usePWAInstall` non registra impression/click/outcome di installazione e `useWorkoutSession` non registra avvio/salvataggio degli allenamenti. Eventuali future statistiche di utilizzo richiedono una decisione di prodotto e il relativo boundary di consenso; non vanno reintrodotte come telemetria tecnica.

## Sanitizzazione e minimizzazione

`src/lib/telemetrySanitizer.ts` sanitizza messaggi e stack. `src/lib/telemetry/detailSanitizer.ts` costituisce il boundary canonico dei dettagli evento: accetta soltanto le chiavi tecniche esplicitamente previste, valida i tipi/limiti pertinenti, scarta chiavi sconosciute e strutture libere e sanitizza le stringhe ammesse.

Lo stesso boundary viene applicato prima della persistenza nella coda telemetrica locale e prima della scrittura Firestore. In questo modo anche un caller obsoleto o una vecchia voce di coda non può trasformare un'etichetta business libera, come il nome di una routine, in telemetria persistita.

I pattern di stringa riconosciuti comprendono:

- indirizzi email;
- IPv4/IPv6;
- Bearer token e JWT;
- chiavi API Firebase riconoscibili;
- path utente Windows/Unix;
- chiavi sensibili come password, token, secret, apiKey e credenziali equivalenti nei formati riconosciuti.

**MUST:** la sanitizzazione riduce il rischio di leakage accidentale ma non rende semanticamente innocuo qualunque testo libero. I nuovi eventi devono usare soltanto metadati tecnici bounded; non introdurre note utente, nomi/etichette business, contenuti nutrizionali, misurazioni, testo sanitario libero o altri dati business nel payload telemetrico.

## Guest e coda offline

La coda è best-effort in `localStorage`, con capacità massima corrente di 50 elementi e namespace owner/device tramite `TelemetryQueueStorage`.

- Se l'utente è autenticato ma offline o un invio fallisce, l'evento può essere accodato e ritentato.
- Un elemento viene inviato soltanto se `payload.userId` è presente, non è `anonymous` e coincide con l'UID autenticato corrente.
- Gli elementi guest senza UID autenticato **non vengono riassegnati al nuovo account e non vengono caricati su Firestore dopo il login**. Possono restare localmente finché la coda best-effort viene sostituita/espulsa secondo il normale ciclo storage.
- Durante una account deletion pending, il transport rifiuta nuovi invii per quell'UID.

Questa semantica è intenzionale: non documentare più un automatico “guest telemetry replay into the new account”.

## Retry e rate limit

- finestra di deduplicazione/rate limit errori: 60 secondi;
- timeout dispatch Firestore: 5 secondi;
- capacità coda: 50 elementi;
- retry per elemento: massimo 3;
- backoff scheduler: da 1 secondo fino a 30 secondi.

Gli errori sono aggregati per hash deterministico di tipo + messaggio sanitizzato. Gli eventi sono append-only secondo le Rules; gli errori ammettono soltanto gli aggiornamenti monotoni previsti dal contratto.

## Security Rules

`firestore.rules` applica:

- ownership (`request.auth.uid == userId`);
- blocco durante `account_deletions/{uid}`;
- allowlist delle chiavi top-level;
- allowlist, limiti di tipo/dimensione e rifiuto di `routineName` nei dettagli evento;
- immutabilità degli eventi, salvo retry identico;
- identità stabile e aggiornamenti monotoni per gli errori aggregati.

Le Rules sono un secondo boundary di sicurezza: non sostituiscono la minimizzazione client e non rendono le stringhe arbitrarie automaticamente sicure dal punto di vista privacy.

## Query operative

Per ispezionare la telemetria di un singolo utente, usare le subcollection private dell'utente autenticato. Analisi amministrative cross-user richiedono un contesto trusted/Admin appropriato: non aggiungere accesso client globale alle collection group.

Esempio singolo utente:

```ts
const errorsRef = collection(db, 'users', userId, 'telemetry_errors');
const recentErrors = query(errorsRef, orderBy('timestamp', 'desc'), limit(20));
const snapshot = await getDocs(recentErrors);
```

Prima di aggiungere una nuova query collection-group, verificare gli indici Firestore reali e l'effettivo caso operativo. Non mantenere in questa guida elenchi di indici ipotetici non presenti nel repository.

## Contratto per nuove metriche

Prima di aggiungere un nuovo evento o dettaglio:

1. dimostrare che serve per diagnosi/stabilità e che non esiste un'alternativa meno invasiva;
2. evitare contenuto business libero;
3. aggiornare il tipo/consumer interessato;
4. aggiornare `sanitizeTelemetryDetails()` e `isValidTelemetryDetails()` / Rules quando serve una nuova chiave;
5. aggiungere test del transport, della coda e delle Security Rules;
6. verificare la coerenza con Privacy Policy, README e `AGENTS.md`;
7. eseguire il gate canonico `npm run verify:m8`.

Una modifica materiale al flusso telemetrico può richiedere anche un aggiornamento della versione Privacy (`LEGAL_VERSIONS.privacy`).
