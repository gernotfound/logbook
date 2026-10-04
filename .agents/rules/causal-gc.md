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

**MUST:** se un ancestor blocca un contender, l'evento ancestor resta immutabile: il contender avanza soltanto il frontier documentale `SyncMeta.clock`; non viene incorporato retroattivamente in `FieldStamp.clock`.

**MUST:** una delete conserva una barriera remove-wins separata in `deleteClock`, composta dai dot delle delete osservate. Una recreation può cambiare il winner visibile senza cancellare la barriera: qualunque update successivo deve dimostrare di aver osservato tutte le delete coperte.

**MUST:** quando una write ancestor diventa visibile, ogni descendant viene rivalutato. Sopravvivono soltanto il winner/candidate descendant che coprono il boundary causale dell'ancestor; candidate nascosti ancora validi devono poter riemergere senza dipendere dall'ordine di delivery.

## Subtree compaction

`compactSyncMeta()` può eliminare uno stamp discendente `D` sotto un ancestor `T` con barriera delete solo quando:

1. `T.deleted === true` oppure `T.deleteClock` è presente dopo una recreation;
2. la chiave di `D` è realmente discendente della chiave di `T` (`T + '/'` come prefisso di segmenti già URI-encoded);
3. la barriera `T.deleteClock` (o il clock della tombstone legacy quando necessario) copre completamente `D.clock`.

**MUST:** `T` stessa e la sua barriera delete restano persistite.

**MUST:** uno stamp concorrente/non osservato che è ancora semanticamente visibile dopo l'arbitration Protocol 2 resta persistito; la compaction non può eliminarlo usando il solo tie-break.

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
