# Causal Metadata Garbage Collection - LogBook

> Stato: normativo da M4 | Baseline M3: `359e3bfdb45952ccce8a00478e2157f53f468dea`

## Obiettivo

M4 riduce la crescita dei metadati `_sync` senza indebolire le garanzie causali stabilite da M2/M3. La compaction deve essere semantics-preserving per business state e causal state osservabile dopo ricompattazione.

## Divieti assoluti

**MUST NOT:** usare età, wall clock, TTL o data dell'ultimo accesso per eliminare tombstone.

**MUST NOT:** eliminare una tombstone terminale se non esiste una prova di stable frontier / replica retirement.

**MUST NOT:** eliminare coordinate positive da `SyncMeta.clock` in base alla sola assenza di una write recente.

**MUST NOT:** usare `stampWins()` come prova di garbage-collectability. I tie-break concorrenti determinano un winner ma non dimostrano inclusione causale.

## Copertura causale

Una vector clock `cover` copre `covered` solo se, per ogni actor presente in `covered`:

```text
cover[actor] >= covered[actor]
```

Le coordinate assenti equivalgono a zero.

Solo questa copertura componente-per-componente può giustificare la rimozione di metadata discendente sotto una tombstone antenata.

## Ancestor-first reconciliation

Per path gerarchici, gli stamp antenati sono il boundary canonico di riconciliazione causale.

**MUST:** `applySemanticOperations()` osserva gli ancestor stamp prima dello stamp dello stesso campo discendente.

**MUST:** la scelta del winner continua a confrontare il clock originale dell'evento contender; un clock già joinato non deve essere usato retroattivamente per alterare il winner.

**MUST:** se un ancestor blocca il contender, l'identity del winner (`actorId`, `seq`, `deleted`) resta quella dell'ancestor, ma il suo clock assorbe il causal context osservato.

**MUST:** se il contender supera l'ancestor, il clock dell'ancestor viene comunque incluso nel `jointClock` che potrà diventare il nuovo same-field stamp.

Questa regola rende una tombstone antenata un causal summary effettivo dei discendenti che copre.

## Subtree compaction

`compactSyncMeta()` può eliminare uno stamp discendente `D` sotto una tombstone antenata `T` solo quando:

1. `T.deleted === true`;
2. la chiave di `D` è realmente discendente della chiave di `T` (`T + '/'` come prefisso di segmenti già URI-encoded);
3. `T.clock` copre completamente `D.clock`.

**MUST:** `T` stessa resta persistita.

**MUST:** uno stamp concorrente/non osservato resta persistito.

**MUST:** sibling e path non discendenti restano invariati.

**MUST:** la compaction è deterministica e idempotente.

Coordinate vector pari a zero possono essere eliminate perché il modello le interpreta esattamente come coordinate assenti.

## Persistenza

La compaction avviene dopo il semantic merge e prima della write Firestore. Il `TransactionOutcome.syncMeta` deve contenere lo stesso metadata compattato scritto nel documento, così `acknowledgeThrough()` conserva localmente il causal state effettivamente persistito.

Una tombstone terminale conta come `fields` persistito: un documento business vuoto non deve essere eliminato da Firestore se la sua barriera causale è ancora necessaria.

## Limite esplicito di M4

Il protocollo corrente non dispone di:

- replica membership autorevole;
- stable frontier globale;
- actor retirement;
- fencing di una replica tornata online dopo il retirement.

Di conseguenza M4 **non** pretende di eliminare tutte le tombstone né tutte le coordinate actor. Un futuro retirement della tombstone terminale richiede una modifica di protocollo che impedisca a una replica stale di reintrodurre operazioni pre-GC o che la costringa a rebase sicuro.

## Gate

Il gate normativo M4 è:

```bash
npm run verify:m4
```

Deve includere integralmente M3 e aggiungere `npm run test:gc`. Un subset verde non equivale al superamento del milestone.
