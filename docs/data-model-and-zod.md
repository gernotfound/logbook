# Modello Dati e Validazione Zod — LogBook

> Stato: normativo | Ultima verifica: 2026-09-09 | File verificati: `src/types.ts`, `src/lib/schema.ts`, `src/lib/schemas/*.ts`, `src/lib/merge.ts`, `src/lib/db.ts`

## UserData — struttura principale

Il tipo `UserData` in `src/types.ts` è l'albero dati completo dell'utente. Contiene:

- `profile` — dati anagrafici e biometrici
- `library` — esercizi personalizzati (array con ID)
- `routines` — schede di allenamento (array con ID)
- `trainingCycles` — cicli di allenamento (array con ID)
- `history` — sessioni di allenamento completate (array con ID)
- `nutrition` — `Record<string, NutritionDay>` indicizzato per data `YYYY-MM-DD`
- `supplements` — integratori personalizzati (array con ID)
- `customFoods` — alimenti personalizzati (array con ID)
- `activeWorkout` — snapshot del workout attivo salvata su cloud (opzionale, può essere `null`)
- `activeCycleId` — ID del ciclo attivo (opzionale, può essere `null`)
- `bodyMeasurements` — misurazioni corporee (array con ID)

## Zod Gateway — difesa runtime

Tutti i dati in ingresso (da Firestore o da IndexedDB) **DEVONO** transitare attraverso `UserDataSchema.parse()` in `src/lib/schema.ts`.

### Perché è cruciale

I tipi TypeScript svaniscono a runtime. Il Gateway Zod funge da barriera per impedire che dati malformati (`NaN`, stringhe al posto di numeri, `null` inattesi, array mancanti) causino crash nei componenti React.

### Helper difensivi

Gli schema usano helper specifici con fallback:
- `safeString`, `safeOptionalString`
- `safeNumber`, `safeOptionalNumber`, `safeOptionalNullableNumber`
- `safeBoolean`, `safeOptionalBoolean`

Ogni helper ha `.catch(...)` e `.default(...)` per garantire un valore sicuro.

### `.passthrough()` — campi addizionali

I sub-schema usano `.passthrough()` per non scartare campi addizionali legittimi. Questo garantisce compatibilità in avanti: se un aggiornamento aggiunge un campo, le versioni precedenti dello schema non lo eliminano.

**SHOULD:** Usare `.passthrough()` solo dove la compatibilità in avanti è intenzionale.

### Comportamento con oggetti fantasma (Ghost Objects)

Il gateway Zod applica validazione severa:
- Scarta a monte elementi nulli, primitivi o con `id` vuoto (`id === ''`).
- Se un elemento ha un `id` valido ma altri campi sono corrotti, l'elemento viene **sanitizzato** con i valori di default (non scartato), preservando la referenza per logbook e cronologia.

### Cache corrotta vs dati cloud invalidi

- **Cache corrotta:** Log minimale, ignorare la cache e usare default sicuro.
- **Dati cloud critici invalidi:** Non sovrascrivere il cloud con default; segnalare errore.
- **Nuovi campi:** Usare `schemaVersion` e migrazioni esplicite quando necessario.

## Valori opzionali Firestore — policy `undefined` vs `null`

**MUST:** Nessun `undefined` nei payload Firestore. Firebase SDK rifiuta categoricamente `undefined`.

Ogni campo opzionale deve usare una sola rappresentazione dell'assenza:
- `null` — per campi esplicitamente vuoti (es. `activeWorkout: null`)
- Chiave omessa — quando il campo non è pertinente

**MUST:** Zod, mapper DB, merge, export e test devono usare la stessa rappresentazione.

Gli schemi difensivi e i mapping di `db.ts` devono garantire la conformità:
```typescript
activeWorkout: state.activeWorkout || null,
activeCycleId: state.activeCycleId || null,
```

## Invariante di modifica — aggiunta nuovi campi cloud-root

Per ogni nuova chiave cloud-root, verificare e aggiornare **tutti** questi file:

1. `src/types.ts` — definizione del tipo
2. `src/lib/schema.ts` o `src/lib/schemas/*.ts` — schema Zod
3. `src/contexts/AuthContext.tsx` — gestione autenticazione
4. `src/lib/db.ts` — persistenza e mapping Firestore
5. `firestore.rules` — regole di sicurezza
6. `tests/firestore_security_rules.test.ts` — test delle regole
7. Logica di merge/import-export
8. Controlli di dimensione del documento

**MUST:** Violare questa invariante causa la perdita silenziosa dei dati al primo ciclo di salvataggio/caricamento a causa dello strip di Zod o del `fast-deep-equal`.

L'aggiunta di stato UI temporaneo o solo locale non implica automaticamente una modifica alle Firestore Rules. Prima classificare il dato come: effimero, locale persistito, cloud-root oppure mensilizzato.

## Subcollection mensilizzate

I dati di cronologia allenamento e nutrizione sono organizzati in subcollection per mese su Firestore:
- `history_months/{YYYY-MM}` — sessioni di allenamento
- `nutrition_months/{YYYY-MM}` — dati nutrizionali giornalieri

Il mese Firestore è derivato dalla data locale della registrazione.
