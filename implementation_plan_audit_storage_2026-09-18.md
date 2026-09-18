# Piano — hardening browser storage dai finding audit

Data: 18 settembre 2026. Baseline: `c9eecd314563603789ed011a7baa0337980a720b` (`main`).
Stato: approvato dal product owner con richiesta di procedere alle correzioni residue degli audit.

## Obiettivo

Correggere la root cause di DEF-03: accessi sincroni a Web Storage non uniformemente protetti, con particolare attenzione ai flussi auth/guest→account e ai marker di cancellazione account. Una indisponibilità di `localStorage` (SecurityError/QuotaExceededError) non deve causare crash silenziosi né permettere che una scelta o un marker critico venga considerato persistito quando non lo è.

## Strategia

1. Introdurre un piccolo boundary sincrono condiviso per `localStorage` con operazioni strict e best-effort.
2. Usare la modalità strict nei marker che fanno parte di un protocollo di sicurezza/lifecycle (guest migration, account deletion, redirect auth): una write fallita deve fermare l'azione o lasciare il flusso in stato recuperabile.
3. Usare la modalità best-effort per preferenze UI non critiche (prompt installazione), senza far crashare l'app.
4. Proteggere le bozze locali e dare feedback visibile quando la persistenza non è disponibile.
5. Riesaminare `waitForPendingWrites` nel logout (DEF-18): timeout/offline possono lasciare il flusso nel percorso unsynced, mentre `permission-denied`/errori non retryable non devono essere mascherati come semplice offline.

## File previsti

- `src/lib/sync/browserStorage.ts` (nuovo boundary)
- `src/contexts/AuthContext.tsx`
- `src/lib/sync/accountGate.ts`
- `src/hooks/useTrainingRoutines.ts`
- `src/components/UI/LoginBox.tsx`
- `src/components/UI/InstallPrompt.tsx`
- test di regressione dedicati

## Invarianti

- Nessun cambio a Data Schema, Sync Protocol, Local Envelope o Backup Schema.
- Nessun cambio a Firestore Rules.
- Guest→account conserva i dati locali fino al completamento del commit autenticato.
- Una policy guest (`merge`/`skip`) non può essere persa silenziosamente prima di avviare l'autenticazione.
- Un marker di cancellazione account illeggibile/non persistibile resta fail-closed.
- I failure best-effort di preferenze UI non bloccano l'app.
- I branch non `main` non generano Vercel Preview Deployment (`vercel.json`).

## Test e accettazione

- regressioni con `Storage.prototype.getItem/setItem/removeItem` che lanciano `SecurityError` o `QuotaExceededError`;
- verifica che una policy guest non persistita impedisca l'azione auth e mostri feedback;
- verifica fail-closed del marker account deletion;
- verifica che prompt installazione e draft routine non crashino in caso di storage indisponibile;
- verifica della semantica logout `waitForPendingWrites` per timeout vs errore non retryable;
- gate canonico completo `npm run verify:m8` sull'esatto HEAD della PR;
- review finale del diff, merge in `main`, CI post-merge sul merge SHA e deployment Vercel production READY sullo stesso SHA.

## Rollback

Il boundary è isolato e non migra dati persistiti. In caso di regressione il lotto può essere revertito senza trasformazioni di schema o cleanup dati. Le chiavi Web Storage correnti restano invariate.