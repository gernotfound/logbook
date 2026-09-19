# Piano — retention dei job di cancellazione account

Baseline iniziale: `66c08531725dc7a5a66aac1dcf5c88e6b7fa4f9c`; branch riallineato a `main` `81dc993204c8b8f365b2a5a89ade14561ec63a9a` prima della validazione finale.

## Obiettivo

Eliminare automaticamente i documenti server-only `account_deletions/{uid}` dopo che la cancellazione account è stata completata, senza indebolire la recovery fail-safe né la barriera cross-device durante una cancellazione in corso.

## Classificazione

CRITICAL: account lifecycle, dati utente, Firestore e recovery post-cancellazione.

## Decisione tecnica

Retention di **30 giorni dal completamento**. Il job `complete` resta disponibile per la recovery di dispositivi rimasti offline e conserva soltanto il tombstone tecnico già previsto dal protocollo; allo scadere viene eliminato dal cron server giornaliero.

La scadenza è materializzata nel job con `purgeAfter`. La query di garbage collection usa soltanto il range su `purgeAfter`, evitando nuovi indici compositi o configurazione Firestore esterna. Non viene usata la TTL policy gestita dalla console: la retention rimane versionata, testabile e sotto il controllo dello stesso backend trusted già responsabile del recovery.

Il cron esegue prima la recovery dei job incompleti e usa il budget residuo per eliminare i tombstone scaduti, così la pulizia non può sottrarre priorità al completamento di una cancellazione utente.

## File coinvolti

- `server/accountDeletion/types.ts`: campo opzionale `purgeAfter`.
- `server/accountDeletion/retention.ts`: policy 30 giorni e GC paginata dei tombstone scaduti.
- `server/accountDeletion/jobStore.ts`: assegna `purgeAfter` solo quando lo stato diventa `complete`.
- `api/account-deletion-cron.ts`: GC nel budget residuo e telemetria `purged` nella risposta.
- `tests/m7_account_deletion_job_store.test.ts`: regressione sulla scadenza impostata al completamento.
- `tests/m7_account_deletion_retention.test.ts`: nessuna cancellazione anticipata/non-complete e cancellazione dei tombstone scaduti.
- `tests/m7_account_deletion_cron.test.ts`: recovery prioritaria e GC invocata solo dopo i job recuperabili.
- `package.json`: include il nuovo test M7 nel gate esistente.
- `.agents/rules/account-lifecycle.md`: documenta la retention e il comportamento fail-safe dopo la scadenza.
- `src/pages/PrivacyPolicy.tsx`: allinea l'informativa alla retention del record tecnico di recovery.

## Invarianti

- Firebase Auth resta l'ultima risorsa cloud eliminata.
- Nessun job `requested/deleting/verifying/failed` viene eliminato dalla retention.
- Nessuna copia locale viene purgata senza prova server di stato `complete`.
- `account_deletions/{uid}` resta server-only e continua a fungere da barriera finché il job non è completo.
- Nessuna modifica a `firestore.rules` e nessun deploy Rules necessario.
- Nessun Preview Deployment Vercel dai branch di sviluppo.

## Validazione

1. test M7 mirati per job store, retention e cron;
2. typecheck server NodeNext;
3. gate canonico completo `npm run verify:m8` sull'HEAD esatto della PR;
4. review finale del diff;
5. nessun merge in `main` senza conferma esplicita del product owner.

## Rollback

Revert del commit/PR. I job già completati con `purgeAfter` restano compatibili con il codice precedente perché il campo è additivo e ignorato dal vecchio runtime.
