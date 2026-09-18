# Piano — hardening Zod ghost objects, Analytics readiness e governance main

Data: 18 settembre 2026. Baseline: `7407a26c22410727c93e1b256a7477c77edf0b71` (`main`).
Stato: autorizzato dal product owner con richiesta esplicita di verificare e applicare i miglioramenti mancanti.

## Scope

1. Estendere l’invariante anti-ghost object dei `DomainParsers` a `routines`, `trainingCycles` e `supplements`, scartando dopo il parse gli elementi la cui identità risultante non è valida.
2. Correggere la race di readiness Firebase Analytics: gli eventi SPA devono attendere un’istanza Analytics supportata, inizializzata e ancora coperta da consenso, anche al cold start o subito dopo il grant.
3. Verificare il ruleset di protezione di `main`; se il gate canonico non è required, documentare il gap. La modifica del ruleset è fuori dallo scope del codice se il connector non espone permessi amministrativi di scrittura.

## Classificazione rischio

CRITICAL per il boundary Zod dei dati persistiti; STANDARD per Analytics; governance esterna per branch protection.

## Decisioni tecniche

- Riutilizzare l’helper `isValidParsedId` già usato da `library` e `customFoods`, senza cambiare gli schema persistiti né i fallback interni: il parser di collezione filtra esclusivamente i record che, dopo sanitizzazione, non conservano un’identità valida.
- Estendere `tests/zod_ghost_invariants.test.ts` alle tre collezioni mancanti e verificare anche che record con ID valido ma campi corrotti restino recuperabili.
- Esporre da `firebase.ts` un getter asincrono consent-aware (`getConsentedAnalytics`) che condivide l’inizializzazione in-flight, ricontrolla il consenso dopo `isSupported()` e restituisce `null` in caso di revoca/unsupported/error.
- Gli effect di `App` attendono il getter, cancellano l’invio se l’effect è diventato stale e ricontrollano il consenso subito prima di `logEvent`.
- Mantenere la revoca immediata della raccolta Analytics e nessuna modifica a dati utente, schema version, Firestore Rules o protocollo sync.

## Invarianti

- Nessun ghost object con ID vuoto/spazi/assente in `library`, `customFoods`, `routines`, `trainingCycles`, `supplements` dopo i `DomainParsers`.
- Elementi con identità valida ma campi non critici corrotti vengono sanitizzati e preservati secondo gli schema correnti.
- Nessun evento Firebase Analytics senza consenso corrente.
- Il primo `screen_view`/`sub_tab_view` non dipende da una navigazione successiva per essere emesso quando Analytics diventa pronto.
- I branch di sviluppo non devono generare Preview Deployment Vercel; `vercel.json` mantiene `main: true`, `**: false`.

## Verifica

- regressioni `zod_ghost_invariants` per routines/cycles/supplements;
- test isolati Analytics per cold-start/grant readiness e revoca durante inizializzazione;
- aggiornamento dei mock App necessari al nuovo getter;
- gate canonico `npm run verify:m8` sull’esatto HEAD via `Milestone Verification / Canonical Verification`;
- review finale del diff sull’esatto SHA candidato;
- merge in `main`, CI post-merge e Vercel production sul merge SHA.

## Rollback

Il lotto non cambia versioni persistite, migrazioni, Firestore Rules o formati cloud. È revertibile come unità senza cleanup dati. Il ruleset GitHub resta una configurazione esterna separata dal rollback del codice.
