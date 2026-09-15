# Modello Dati e Validazione Zod — LogBook

> Stato: normativo | Ultima verifica: 2026-09-15 | File verificati: `src/types.ts`, `src/lib/schema.ts`, `src/lib/schemas/*.ts`, `src/lib/merge.ts`, `src/lib/db.ts`, `src/lib/sync/documentProjection.ts`, `firestore.rules`

## Quattro piani distinti

`UserData` è il modello applicativo completo, ma non coincide con un singolo documento Firestore. Prima di aggiungere o spostare un campo, classificare esplicitamente dove vive.

| Piano | Fonte operativa | Contenuto corrente |
|---|---|---|
| **Application `UserData`** | `src/types.ts` + `UserDataSchema` | `profile`, `library`, `routines`, `history`, `nutrition`, `customFoods`, `activeWorkout`, `nutritionPlanning`, `trainingCycles`, `activeCycleId`, `supplements`, `activePains`, `catalogOverrides`, `legalConsent`, `nutritionPlanningOrigin`, `pendingConflicts` |
| **Firestore root** | `src/lib/sync/documentProjection.ts` (`rootKeys`) + Rules | `profile`, `library`, `routines`, `customFoods`, `activeWorkout`, `trainingCycles`, `activeCycleId`, `nutritionPlanning`, `supplements`, `activePains`, `catalogOverrides`, `legalConsent`, `nutritionPlanningOrigin` |
| **Shard mensili Firestore** | `documentProjection.ts` | `history_months/{YYYY-MM}` e `nutrition_months/{YYYY-MM}` |
| **Application/local-only** | envelope/store | `pendingConflicts` è parte di `UserData` e del recovery locale/backup, ma non è una chiave del root Firestore |

`library` e `customFoods` sono campi legacy del modello applicativo; la projection corrente li normalizza rispetto al catalogo globale prima della write root.

Le misurazioni corporee non sono un array root `bodyMeasurements`: peso, BF, circonferenze e sonno sono campi di `NutritionDay`, quindi seguono la persistenza mensilizzata di `nutrition`.

## Zod Gateway — difesa runtime

Tutti i dati in ingresso dai boundary persistiti **DEVONO** essere normalizzati secondo la versione applicabile e poi transitare attraverso `UserDataSchema.parse()` prima di diventare stato business corrente.

### Perché è cruciale

I tipi TypeScript svaniscono a runtime. Il Gateway Zod impedisce che dati malformati (`NaN`, stringhe al posto di numeri, `null` inattesi, array mancanti) entrino nel modello operativo senza sanitizzazione/validazione prevista.

### Helper difensivi

Gli schema usano helper specifici con fallback, fra cui:
- `safeString`, `safeOptionalString`
- `safeNumber`, `safeOptionalNumber`, `safeOptionalNullableNumber`
- `safeBoolean`, `safeOptionalBoolean`

Ogni helper applica il comportamento difensivo definito negli schema correnti; non duplicare questa logica nei consumer.

### `.passthrough()` — campi addizionali

I sub-schema possono usare `.passthrough()` dove la compatibilità in avanti è intenzionale.

**SHOULD:** Non aggiungere `.passthrough()` come scorciatoia per evitare di modellare un campo persistito. Un campo business nuovo deve avere classificazione storage e schema espliciti.

### Comportamento con oggetti fantasma (Ghost Objects)

Il gateway applica validazione difensiva agli elementi collezione:
- scarta elementi nulli/primitivi o privi dell'identità richiesta;
- se un elemento mantiene un'identità valida ma contiene campi corrotti, gli schema possono sanitizzare i campi secondo i default previsti preservando la referenza.

### Cache corrotta vs dati cloud invalidi

- **Cache corrotta:** non reinterpretare bytes/versioni incompatibili come dati correnti; preservare il dato recuperabile quando previsto dal boundary.
- **Dati cloud critici invalidi:** non sovrascrivere il cloud con default inventati; propagare/classificare l'errore.
- **Versioni future:** fail-closed / `update-required` secondo `storage-and-sync.md`.

## Valori opzionali Firestore — policy `undefined` vs `null`

**MUST:** Nessun `undefined` nei payload Firestore.

Ogni boundary di projection deve produrre una rappresentazione coerente:
- `null` quando il contratto root rappresenta esplicitamente l'assenza;
- chiave omessa dove il contratto lo prevede;
- mai affidarsi a `undefined` perché Firebase SDK lo rifiuta.

`documentProjection.ts` applica `removeUndefinedValues()` prima delle write.

## Invariante di modifica — nuova chiave cloud-root

Per ogni nuova chiave del root Firestore verificare e aggiornare, dove applicabile:

1. `src/types.ts` — tipo applicativo;
2. `src/lib/schema.ts` / `src/lib/schemas/*.ts` — Zod;
3. `src/lib/sync/documentProjection.ts` — `rootKeys`, projection e hydration root;
4. `src/contexts/AuthContext.tsx` — bootstrap/hydration/merge quando il campo partecipa a quei flussi;
5. `src/lib/db.ts` e moduli DB correlati — boundary Firestore;
6. `firestore.rules` — allowlist/validazione security;
7. `tests/firestore_security_rules.test.ts` — coverage Rules;
8. merge/import/export e backup (`src/lib/merge.ts`, `src/lib/export.ts` e moduli correlati);
9. semantic projection/path ownership se il campo è mutabile tramite Domain Operations;
10. controlli di dimensione del documento e test di regressione pertinenti.

**MUST:** Non assumere che aggiungere un campo a `UserDataSchema` lo renda automaticamente cloud-root. Se manca da `rootKeys`, non verrà proiettato nel documento root dalle semantic write correnti.

**MUST:** Un campo local-only non va aggiunto a Rules/root projection soltanto perché è parte di `UserData`.

## Shard mensili

I dati ad alta cardinalità sono organizzati per mese:

- `history` → `history_months/{YYYY-MM}`;
- `nutrition` → `nutrition_months/{YYYY-MM}`.

Il mese deriva dalla data locale della registrazione. Hydration parziale/completa e merge dei mesi seguono gli invarianti di `.agents/rules/storage-and-sync.md`; non trattare un mese non caricato come mese vuoto.

## Domain Operations

La classificazione storage non cambia il mutation boundary M8. Le normali mutazioni business UI/hook devono usare Domain Operations; snapshot-save resta confinato ai boundary bulk/compatibility allowlisted in `.agents/rules/domain-operations.md`.
