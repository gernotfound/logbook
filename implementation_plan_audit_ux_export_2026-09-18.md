# Piano — correzioni audit UX/export

Data: 18 settembre 2026. Baseline attuale: `b3c938afe683c03bca4370adf83ed525e398170a` (`main`).
Piano originariamente preparato su `c9eecd314563603789ed011a7baa0337980a720b`, poi riallineato al `main` successivo alla PR #54 prima dell'implementazione.
Stato: approvato dal product owner con richiesta di procedere alle correzioni residue degli audit.

## Scope

- DEF-05: usare la data locale canonica nel nome del backup di emergenza.
- DEF-06: eliminare il `<dialog>` nativo dal conflitto nutrizionale e usare un overlay controllato dall'app con focus trap/restore ed Escape.
- DEF-07: dare feedback visibile alle mutazioni fallite in `TrainingPlanning`, mantenendo l'editor aperto quando il salvataggio fallisce.
- DEF-08: ripristinare il code splitting di `export.ts` rimuovendo gli import statici dai consumer UI e caricando il modulo solo all'azione utente.

## Invarianti

- Nessun cambio al formato backup/import o alle versioni persistite.
- Nessun cambio al protocollo sync, IndexedDB o Firestore Rules.
- Il conflitto nutrizionale mantiene le stesse due risoluzioni (`cloud`/`local`) e non modifica dati fino alla conferma esplicita.
- Tutte le azioni fallite restano osservabili dall'utente.
- I branch di sviluppo non producono Preview Deployment Vercel.

## Verifica

- test di regressione per data locale del backup;
- test accessibilità/lifecycle del conflict overlay (assenza `<dialog>`, Escape, focus restore);
- test che un errore di persistenza in pianificazione produce feedback e non chiude l'editor;
- build senza warning `INEFFECTIVE_DYNAMIC_IMPORT` per `src/lib/export.ts`;
- gate canonico `npm run verify:m8` sull'esatto HEAD;
- review finale, merge, CI post-merge e Vercel production sul merge SHA.

## Rollback

Il lotto non cambia schema o dati persistiti. È revertibile come unità senza migrazioni o cleanup.
