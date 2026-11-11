# Domain Operations — contratto delle mutazioni TheLogBook

**Quando leggere:** mutazioni UI/hook, reducer, compiler, identità e commit di dominio.
**Non inferire:** Domain Operations è un layer di intento locale, non un nuovo sync protocol persistito.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Obiettivo

M8 rende esplicito l'intento delle mutazioni business senza introdurre un secondo protocollo di sincronizzazione.

Il percorso normativo per una normale azione utente è:

1. UI/hook produce una `DomainOperation` tipizzata.
2. Il reducer puro calcola lo stato e il compiler genera `SemanticOperation`.
3. Il commit IndexedDB rende durevoli insieme business state e journal nell'envelope corrente.
4. `transactionWriter` consegna il journal a Firestore dopo i gate di replica.

`DomainOperation` è un contratto di authoring locale. Non è un formato cloud, non è un nuovo sync protocol e non viene persistita come nuova coda.

## Versioni

M8 non ha introdotto nuove versioni persistite. La fonte eseguibile attuale è `src/lib/schemaEvolution.ts` con `CURRENT_DATA_SCHEMA`, `CURRENT_SYNC_PROTOCOL`, `CURRENT_LOCAL_ENVELOPE` e `CURRENT_BACKUP_SCHEMA`: non derivare questi numeri dalla versione PWA né da questa nota storica.

“Domain Operations V4” è il nome storico del layer di intenti, non una relazione numerica con l'envelope né una quinta versione persistita. Le DomainOperation vengono compilate in `SemanticOperation` prima della persistenza del journal.

## Boundary normativo

### Mutazioni ordinarie

**MUST:** una mutazione business originata da UI/hook usa `dispatchDomainOperation()`.

**MUST:** il reducer di dominio produce uno `UserData` valido tramite `UserDataSchema`.

**MUST:** `commitDomainOperations()` persiste nello stesso update IndexedDB il nuovo business state e, quando presenti, `actorSeq`, vector clock, revision e SemanticOperation generate.

**MUST:** una failure del commit locale non deve lasciare business state e journal in revisioni differenti.

**MUST:** il feedback ottimistico in Zustand non sostituisce la durabilità IndexedDB; il risultato del salvataggio continua a seguire il contratto `SyncResult` esistente.

### Boundary snapshot consentiti

Il percorso snapshot `saveUserData` / `commitLocal` resta ammesso solo quando l'input è per natura un dataset bulk e non una singola intenzione utente:

- bootstrap / inizializzazione envelope;
- hydration cloud;
- guest → account merge;
- import/restore di backup o share;
- recovery dei formati supportati;
- implementazione interna del sync/store necessaria a questi flussi.

**MUST NOT:** aggiungere nuovi consumer ordinari snapshot-based per comodità.

Il gate M8 contiene un controllo statico dedicato; ogni eccezione deve essere piccola, esplicita e documentata.

## Identità

Le operazioni su collezioni keyed richiedono una identità stabile e valida.

**MUST:** ID assente, vuoto, invalido o duplicato causa errore fail-fast.

**MUST NOT:** una DomainOperation deve degradare automaticamente in una write atomica dell'intero array quando non riesce a risolvere l'identità.

Il fallback atomico storico di `diffDocuments()` resta disponibile esclusivamente per i boundary snapshot bulk esplicitamente consentiti, nel formato supportato.

Identità correnti:

- routine/supplement/workout/meal/intake/exercise: `id`;
- routine exercise: `exId`;
- training-cycle routine: `routineId`;
- food: `id`, normalizzato in modo deterministico al boundary di dominio.

## Ordering

Per le collezioni `ordered-keyed` già definite dal protocollo causale, un reorder usa esclusivamente il payload semantico `$order` esistente.

**MUST:** un reorder contiene esattamente l'insieme corrente degli ID, senza duplicati o omissioni.

**MUST:** upsert/delete e reorder possono essere nello stesso batch di dominio; il compiler deve produrre SemanticOperation compatibili con la semantica M2–M4 già validata.

## Scope del compiler

`compileDomainOperations()` non esegue un diff globale dell'intero `UserData`.

Per ogni DomainOperation costruisce una projection scope che contiene solo:

- root key dichiarate dall'operazione; oppure
- documento mensile + entity ID dichiarati dall'operazione.

Il diff semantico viene poi delegato a `diffDocuments()` sulle sole projection scope.

**MUST (proiezione validata):** il compiler utilizza `projectValidatedDomainDocuments()` soltanto su input `before` già verificato dal gateway dell'envelope locale (o seed iniziale normalizzato) e `after` prodotto dal reducer Zod. Non usare questa scorciatoia per dati da rete, import, cache non autenticata o snapshot non validati. `projectDocuments()` mantiene la validazione completa per tutti gli altri chiamanti. I test devono confrontare le proiezioni scoped con la versione completamente validata e verificare che le operazioni causali prodotte siano identiche.

**MUST:** proprietà non appartenenti allo scope dell'operazione non generano SemanticOperation.

**MUST:** il compiler riusa merge policy, keyed identity, `$order`, tombstone e active-workout guard del protocollo corrente; non deve duplicarne una variante incompatibile.

## Monthly data

Per nutrition/history, la DomainOperation individua esplicitamente data/ID e quindi shard mensile.

**MUST:** un workout spostato tra mesi genera tombstone nel vecchio shard e upsert nel nuovo shard.

**MUST:** una cancellazione mensile genera la tombstone causale esistente e non una cancellazione non tracciata dello snapshot.

**MUST:** i totali nutrizionali `kcal/carbs/pro/fat` restano derivati dai pasti; non sono intenti indipendenti. Il normalizzatore semantico continua a ricalcolarli.

`meals`, `supplementsIntake` e `cardioSessions` restano collezioni mensili identificate da ID stabile; edit concorrenti su entità diverse non devono collassare l'intero array.

## Patch

Per operazioni `*.patch`:

- proprietà assente dal patch = invariata;
- proprietà con valore concreto = upsert;
- proprietà esplicitamente `undefined` = rimozione locale della proprietà prima della validazione/proiezione.

Il payload Firestore finale continua a non contenere `undefined`.

## Active workout

Lo snapshot device-local `localWorkout` resta distinto da `activeWorkout` cloud come stabilito dagli invarianti precedenti.

Quando una DomainOperation modifica `activeWorkout` cloud, le SemanticOperation discendenti continuano a usare la guard sull'ID sessione implementata da `semanticProjection.ts`.

**MUST:** una operation appartenente a una sessione stale non deve mutare la sessione corrente.

`workout.complete` è un intento composto: storico completato + clear dello snapshot cloud + nuovo `activePains` diventano un unico commit locale di dominio, pur potendo produrre SemanticOperation su più documenti.

## Crash consistency e replay

M8 eredita integralmente M3:

- business state + journal locale diventano durevoli insieme;
- lost acknowledgement mantiene il batch replayable;
- retry della stessa SemanticOperation resta idempotente;
- una nuova local edit durante remote→ack non viene rimossa dall'ack precedente;
- restart usa esclusivamente l'envelope persistito.

M8 non introduce memoria volatile come fonte di durabilità.

## Causal semantics

M8 eredita integralmente M2/M4:

- vector clock resta la base causale; l'arbitraggio dei `FieldStamp` (attualmente `compareStamps()` in `semanticProjection/metadata.ts`) usa l'ordine totale transitivo introdotto da Sync Protocol 2 e invariato in Protocol 3;
- ancestor-first reconciliation richiede che i descendant coprano causalmente lo stamp ancestor e la sua barriera delete; l'ordine totale fra contender dello stesso field non sostituisce tale prova;
- delete-vs-edit concorrente mantiene delete bias quando i contender hanno pari cardinalità causale, senza introdurre una relazione pairwise non transitiva;
- causal compaction resta dopo il merge e prima della write Firestore;
- nessun TTL/wall-clock GC viene introdotto.

## Test di equivalenza

Per le famiglie di DomainOperation principali il gate verifica:

1. reducer business → stato atteso;
2. compiler → SemanticOperation scope-limited;
3. replay delle SemanticOperation sulla projection precedente → stessa projection del reducer;
4. invarianti di identità/order;
5. commit IndexedDB atomico e concorrente;
6. nessun bump delle quattro versioni persistite.

## Gate

Il gate canonico M8 è:

```bash
npm run verify:m8
```

`verify:m8` include integralmente `verify:m7`, poi aggiunge i test Domain Operations e il domain-boundary checker.

Un subset verde non equivale al gate canonico. Vedere [Verifica CI](ci-verification.md).
