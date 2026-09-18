# Piano miglioramenti audit — 18 settembre 2026

Stato: approvato dall'utente con richiesta esplicita di procedere.
Baseline di sviluppo: `33f377b1a48d86a0b24c98578a5ce25a2565a215`.
Branch: `improve/audit-2026-09-18`.

## Obiettivi

1. Correggere il recovery dell'ErrorBoundary: il comando oggi chiamato “Hard reset” cancella indiscriminatamente `localStorage` ma non la persistenza principale IndexedDB. Il recovery deve usare il boundary owner-scoped già testato e non dichiarare una pulizia riuscita se una parte fallisce.
2. Aggiornare Firebase client da 12.18.x a 12.19.x, mantenendo isolato il cambiamento e validando in particolare Auth/redirect/popup e guest→account.
3. Non duplicare telemetria client già presente: il bootstrap React e TelemetryHub tracciano già errori caught/uncaught/recoverable con coda locale e Firestore.
4. Tenere React 19.3 separato: non è necessario per risolvere i finding ad alta priorità e aumenterebbe le variabili nel task Auth/recovery.
5. Garantire che i branch di sviluppo non producano Preview Vercel e che `main` continui a produrre il deployment production.

## Modifiche previste

- `src/components/UI/ErrorBoundary.tsx`: sostituire `localStorage.clear()` con il purge owner-scoped già esistente, usare messaggi coerenti con il comportamento reale e non ricaricare se la pulizia fallisce.
- `tests/error_boundary.test.tsx`: regressioni su conferma, cancellazione annullata e failure della pulizia.
- `package.json` e `package-lock.json`: aggiornamento Firebase 12.19.x solo se il lockfile può essere rigenerato coerentemente; nessuna modifica manifest-only.
- `vercel.json`: già blindato sulla baseline per consentire deploy automatici solo da `main` e ignorare tutti gli altri branch.

## Invarianti

- Nessun dato viene dichiarato eliminato/sincronizzato se l'operazione sottostante fallisce.
- Nessun `localStorage.clear()` globale nel recovery.
- La cache Service Worker non viene eliminata.
- Account-deletion receipt e isolamento owner restano governati dal boundary esistente.
- Nessuna modifica a schema dati, Sync Protocol, Local Envelope o Backup Schema.
- Nessuna modifica a Firestore Rules in questo task.

## Verifica

- Test mirati ErrorBoundary/recovery durante lo sviluppo.
- Review finale del diff sull'esatto HEAD candidato.
- Gate canonico completo `npm run verify:m8` sull'esatto HEAD tramite `Milestone Verification / Canonical Verification`.
- `npm audit --audit-level=high` tramite workflow.
- Dopo merge: gate sul commit effettivo di `main` verde e deployment Vercel production dello stesso commit in stato READY.
- Verifica che il branch di sviluppo non abbia generato Preview Vercel.

## Rollback

- Recovery UI: revert del commit dedicato ripristina il comportamento precedente senza migrazioni persistite.
- Firebase: se il gate o i test Auth falliscono, revert dell'upgrade package+lock come unità atomica.
- Vercel: la configurazione può essere ripristinata separatamente; `main` resta esplicitamente abilitato.
