# Piano di implementazione — esportazione granulare avanzata

## Obiettivo
Completare e blindare l'esportazione condivisibile di LogBook consentendo la selezione granulare di esercizi, schede e pianificazioni, con risoluzione transitiva delle dipendenze e senza riferimenti interni orfani nel payload generato.

## Stato iniziale verificato
- `src/lib/export.ts` contiene già una prima dependency resolution ciclo → scheda → esercizio, ma il tipo delle opzioni è inline e i riferimenti interni non vengono ripuliti se i dati sorgente sono incoerenti.
- `src/components/SettingsView.tsx` contiene già un primo `ExportSelector` inline con `fuse.js`.
- `fuse.js` è già una dipendenza del progetto; non serve modificare `package.json` né il lockfile.
- `tests/challenger_export_granular_adversarial.test.tsx` esiste già e viene preservato; si aggiungono unit test complementari.
- `implementation_plan.md` è il piano approvato dell'audit LB-01–LB-26 e non va sovrascritto; questo piano separato documenta esclusivamente la feature richiesta.

## Modifiche
1. `src/types.ts`: aggiungere `ExportShareOptions` come contratto condiviso.
2. `src/lib/export.ts`: estrarre una funzione pura di costruzione del payload share, risolvere dipendenze in modo deterministico, deduplicare selezioni, ignorare ID selezionati inesistenti e rimuovere riferimenti annidati realmente orfani senza mutare `UserData`.
3. `src/components/ExportSelector.tsx`: estrarre il selettore riusabile con ricerca fuzzy, checkbox, accessibilità e vincoli mobile di `AGENTS.md`.
4. `src/components/SettingsView.tsx`: integrare il nuovo componente e usare fallback array stabile a livello modulo.
5. `tests/export_granular.test.tsx`: coprire dependency resolution, deduplica, dati incoerenti e UI fuzzy.
6. Preservare e rieseguire `tests/challenger_export_granular_adversarial.test.tsx` come stress test esistente.

## Rischi e mitigazioni
- Compatibilità import: mantenere invariati `version: 1` e `type: 'share'`.
- Regressioni su dati esistenti: funzione pura e non mutante, ordine degli array sorgente preservato.
- Prestazioni: usare `Map`/`Set` per lookup O(1) e mantenere lo stress test dedicato.
- UX mobile: input/select a 16 px e controlli principali con altezza minima 44 px.

## Verifica prevista
Eseguire nell'ordine richiesto da `AGENTS.md`: `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`, oltre a `npm run test:stress` per il challenger.

## Rollback
Un singolo revert del commit della feature ripristina integralmente il comportamento precedente; nessuna migrazione dati, schema Firestore o dipendenza viene introdotta.

## AGENTS.md
Nessuna modifica prevista: le regole attuali coprono già dati, UX, testing e processo. La feature non introduce una nuova invariante globale che giustifichi ampliare il documento.
