# Recovery operativo — cancellazione dati salute (PR #301)

> **Non attivo in Production finché i gate GDPR e di rilascio non sono risolti.** Questa guida descrive soltanto la proposta tecnica sulla PR, non attesta un deployment o una configurazione di alerting presso i provider.

## Flusso e ordine dei deployment

- L'endpoint di revoca registra un marker server-only prima di avviare la cancellazione. L'utente riceve conferma della **revoca** solo dopo il commit del marker, non necessariamente della cancellazione completa.
- La cancellazione è idempotente, isolata per UID e protetta da lease. Un job incompleto rimane `requested`, `deleting` o `failed`; uno `blocked` non può essere ritentato automaticamente senza revisione dei dati/contratti inattesi.
- Il cron Vercel `/api/account-deletion-cron` è configurato per le **03:00 UTC ogni giorno** e richiede `CRON_SECRET`. La funzione riserva 95 secondi alla cancellazione salute dopo la finestra account-deletion, poi 20 secondi alle operazioni di manutenzione. Questi sono limiti di budget, non SLA di completamento.
- La ricerca health seleziona fino a 25 marker per esecuzione, ordinati per `eraseUpdatedAt` crescente. Un errore aggiornato viene posto dietro ai job meno recenti. La query dipende dall'indice composito `health_consent_revocations(eraseStatus ASC, eraseUpdatedAt ASC)` presente in `firestore.indexes.json`.
- Prima di rendere operativo il nuovo cron, **verificare l'indice Firestore live**: se un indice necessario manca o è in stato building, il nuovo selettore potrebbe fallire prima di effettuare retry. La creazione dell'indice non è implicata dalla CI dell'Emulator.

## Monitoraggio senza identificatori personali

Il cron emette campi aggregati `accountDiscoveryFailed`, `accountRunsFailed`, `erasuresScanned`, `erasuresComplete`, `erasuresPending`, `erasuresBusy`, `erasuresFailed`, `erasuresDiscoveryFailed`, `erasuresBlocked` e `erasuresBacklogPossible`. Il valore `erasuresBlocked` è `null` quando la sonda non è riuscita: non interpretarlo come assenza di blocchi.

Nei log Vercel cercare:

- `[account-deletion-cron] account deletion discovery failed` / `account deletion retry failed`: recupero account da analizzare; la cancellazione salute prosegue comunque.
- `[account-deletion-cron] health erasure discovery failed`: errore di lettura della coda salute, incluso indice mancante; le altre manutenzioni continuano.
- `[account-deletion-cron] health erasure retry failed`: fallimento ritentabile o da approfondire; viene registrato solo il tipo di errore sanitizzato.
- `[account-deletion-cron] manual health erasure intervention required`: esiste almeno un marker `blocked`; serve revisione.
- `[account-deletion-cron] health erasure monitoring unavailable`: controllo dei job bloccati non attendibile.
- `erasuresBacklogPossible: true`: la pagina ha raggiunto 25 marker, quindi la coda potrebbe essere più lunga della singola esecuzione.

**Nessun invio automatico di email/push o alert esterno è implementato**. Prima del go-live verificare nei provider l'esecuzione giornaliera e predisporre una regola di allarme sui log o un presidio operativo documentato. Non dichiarare coperta una richiesta GDPR sulla sola base di un HTTP 200 del cron.

## Diagnosi e recupero

1. Dal backend/Firestore amministrativo verificare in sola lettura lo stato della collection `health_consent_revocations` e le date `eraseUpdatedAt`. Non esportare UID, contenuti salute o credenziali verso log/servizi non autorizzati.
2. Per `requested/deleting/failed`: controllare l'esecuzione effettiva del cron, la disponibilità di `CRON_SECRET` e Firebase Admin, l'indice Firestore e i risultati dopo più cicli. Il retry è automatico; non azzerare marker, lease o timestamps per accelerarlo.
3. Per `blocked`: prima identificare la collection privata o i discendenti inattesi, valutarne scopo e titolarità, correggere il contratto di cancellazione con regressioni e review CRITICAL. Richiedere autorizzazione specifica prima di qualunque pulizia distruttiva manuale su dati reali. Non cancellare marker o ignorare `listDocuments()` per trasformare un blocco in falso successo.
4. Verificare la barriera Firestore e la mancanza di dati sanitari residui, inclusi documenti genitore mancanti con sottoraccolte, prima di considerare il job completato. L'account Firebase Authentication deve rimanere attivo dopo la sola revoca.
5. Registrare incident, durata, causa, intervento e prova tecnica minima, con accesso limitato. Se il problema coinvolge l'esercizio di diritti, seguire separatamente la procedura privacy validata.

## Gate pre-rilascio

Richiesti: controlli GitHub exact-SHA, review del codice e delle Rules, indice Firestore Production verificato, Vercel Production da `main`, Firebase Hosting/Rules live, cron realmente eseguito e monitorato, smoke su browser/dispositivi e approvazione degli aspetti legali del trattamento e della retention. Non testare la cancellazione distruttiva su dati reali senza specifico mandato.
