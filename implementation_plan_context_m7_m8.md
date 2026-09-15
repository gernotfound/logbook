# Piano refresh normativo M7/M8

Data: 15 settembre 2026. Baseline: `abc73a2b6dd94430ef0c365d258a7cb30d9b9ab4`.
Stato: approvato dall'utente; scope documentale SENSITIVE.

## Obiettivo

Allineare `AGENTS.md` e le regole normative correnti all'architettura effettiva dopo M7 Server Account Deletion e M8 Domain Operations V4, eliminando prescrizioni obsolete senza duplicare le fonti canoniche già corrette.

Il refresh non modifica codice applicativo, Firestore Rules, Domain Operations, `.env.example`, workflow GitHub, contract checker CI, README o documenti storici fuori scope.

## File coinvolti

- `AGENTS.md`
- `.agents/rules/data-model-and-zod.md`
- `.agents/rules/account-lifecycle.md`
- `.agents/rules/verification-hardening.md`
- `.agents/rules/ci-verification.md`
- `.agents/rules/storage-and-sync.md`
- `.agents/rules/crash-consistency.md`
- `.agents/rules/firebase-config.md`

## Modifiche previste

1. Rendere `ci-verification.md` la fonte normativa del gate corrente: workflow `Milestone Verification`, job/check `Canonical Verification`, umbrella command `npm run verify:m8`; chiarire che `npm audit` è step esterno e che stderr/warning da soli non causano failure.
2. In `AGENTS.md`, sostituire la checklist ridotta come criterio di completamento con `npm run verify:m8`, mantenendo lint/test/build/E2E come strumenti diagnostici/sotto-gate; completare l'indice delle regole normative.
3. Correggere l'invariante cloud-root includendo `src/lib/sync/documentProjection.ts`; classificare sempre i dati prima come application `UserData`, cloud-root, shard mensile, local-only o effimero.
4. Ricostruire `data-model-and-zod.md` dal `UserData` corrente e dalla projection reale: `history`/`nutrition` mensilizzati; `pendingConflicts` application/local state non cloud-root.
5. Correggere `account-lifecycle.md`: Backup Schema V3, V1/V2 non importabili nella baseline clean-cut; preservare il raw legacy recovery export V1 come artefatto esplicito di recupero non importabile. Non duplicare il protocollo M7 deletion già corretto. Rimuovere/qualificare fatti esterni non verificabili come il piano Vercel.
6. Aggiornare `verification-hardening.md` affinché le meal mutations attraversino `useNutritionMeals` + production Domain Operation boundary; il test può ancora osservare il boundary DB a valle per la rejection propagation.
7. In `storage-and-sync.md`, conservare invarianti storage/sync M0-M8, correggere il gate corrente e distinguere Backup V3 dal raw legacy recovery V1.
8. In `crash-consistency.md`, mantenere `verify:m3` come subgate storico M3 e indicare `verify:m8` come umbrella gate corrente.
9. In `firebase-config.md`, separare: otto env client fail-fast; App Check site key opzionale al bootstrap con fallback; tre env Firebase Admin richieste dai server flow; `CRON_SECRET` richiesto dal cron. Stato console, IAM, secret provisionati e Deployment Checks restano `VERIFY` se non verificati direttamente.

## Invarianti da preservare

- offline-first startup e IndexedDB come persistenza locale principale;
- fail-closed sulle future versioni;
- Data 1 / Sync 1 / Local Envelope 4 / Backup 3;
- business state + semantic journal durevoli nello stesso update IndexedDB;
- causal metadata, tombstone e vector clock;
- reload barrier fail-safe e background flush;
- guest-to-account migration safety;
- account deletion con Auth eliminata per ultima e local purge solo dopo `complete`;
- Firestore Rules enforcement;
- exact-head CI, no-skips e composizione transitiva M0-M8;
- `domain-operations.md` come fonte canonica del mutation boundary;
- `ci-verification.md` come fonte canonica del gate corrente.

## Rischi

- Trasformare una descrizione storica di milestone in una falsa norma corrente.
- Confondere `UserData` applicativo con il documento root Firestore e causare omissioni nella projection.
- Confondere il raw recovery V1 con un formato importabile.
- Rendere troppo permissiva l'allowlist snapshot M8 descrivendo genericamente store/internal code come esente.
- Documentare configurazioni esterne non dimostrate dal repository come fatti.

## Verifica

Dopo il diff:

1. rileggere ogni file modificato e confrontarlo con i file eseguibili citati;
2. controllare UTF-8/BOM e assenza di mojibake;
3. controllare link e nomi file;
4. verificare che nessun file fuori scope sia cambiato;
5. eseguire il gate repository pertinente. Poiché il repository definisce `npm run verify:m8` come umbrella gate corrente, il candidato finale deve essere validato con `npm run verify:m8` sull'HEAD esatto; il workflow GitHub aggiunge separatamente `npm audit --audit-level=high`.

## Rollback

Il branch è dedicato e parte dall'HEAD `abc73a2…`. Ogni modifica è documentale e reversibile; in caso di contraddizione si può ripristinare il singolo file dalla baseline senza toccare dati, schema, Rules o runtime.