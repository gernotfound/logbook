# Causal Metadata Garbage Collection - LogBook

> Stato: normativo da M4 | Baseline M3: `359e3bfdb45952ccce8a00478e2157f53f468dea`

## Obiettivo

M4 riduce la crescita dei metadati `_sync` senza indebolire le garanzie causali stabilite da M2/M3. La compaction deve essere semantics-preserving per business state e causal state osservabile dopo ricompattazione.

## Divieti assoluti

**MUST NOT:** usare età, wall clock, TTL o data dell'ultimo accesso per eliminare tombstone.

**MUST NOT:** eliminare una tombstone terminale se non esiste una prova di stable frontier / replica retirement.

**MUST NOT:** eliminare coordinate positive da `SyncMeta.clock` in base alla sola assenza di una write recente.

**MUST NOT:** usare l'esito dell'arbitraggio totale dei `FieldStamp` (attualmente `compareStamps()`) come prova di garbage-collectability. I tie-break concorrenti determinano un winner ma non dimostrano inclusione causale.

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
3. la barriera `T.deleteClock` (o il clock della tombstone terminale) copre completamente `D.clock` **e** i clock di ogni `D.candidates`; un contender nascosto non coperto impedisce la compaction dell'intero descendant.

**MUST:** senza una `stableFrontier` che copra integralmente lo stamp, `T` stessa e la sua barriera delete restano persistite. Con Protocol 3 possono essere ritirate solo secondo la prova stable-frontier descritta sotto.

**MUST:** uno stamp concorrente/non osservato che è ancora semanticamente visibile dopo l'arbitration causale resta persistito; la compaction non può eliminarlo usando il solo tie-break.

**MUST:** sibling e path non discendenti restano invariati.

**MUST:** la compaction è deterministica e idempotente.

Coordinate vector pari a zero possono essere eliminate perché il modello le interpreta esattamente come coordinate assenti.

## Persistenza

La compaction avviene dopo il semantic merge e prima della write Firestore. Il `TransactionOutcome.syncMeta` deve contenere lo stesso metadata compattato scritto nel documento, così `acknowledgeThrough()` conserva localmente il causal state effettivamente persistito.

Una tombstone terminale conta come `fields` persistito: un documento business vuoto non deve essere eliminato da Firestore se la sua barriera causale è ancora necessaria.

## Sync Protocol 3: stable frontier e replica retirement

Protocol 3 chiude il limite storico di M4 con un registro per-account in `users/{uid}/sync_control/state`:

- massimo 16 slot actor `s00`…`s15`;
- `replicaId` e `generation` identificano l'incarnazione corrente dello slot;
- `lastSeq` è monotona e non riparte da zero quando uno slot viene riusato;
- `checkpointClock` deriva da una scansione cloud `all` completa;
- checkpoint ordinario almeno ogni 30 giorni;
- lease massima 360 giorni;
- una generation retired/riusata viene fenced e non può più pubblicare il vecchio journal.

La `stableFrontier` è il minimo componente-per-componente dei `checkpointClock` di tutte e sole le repliche `active`. Una coordinata assente vale zero e blocca il GC dello stato che la richiede.

**MUST:** una tombstone terminale può essere eliminata solo quando la stable frontier copre winner clock, `deleteClock` e tutti i candidate clock dello stamp.

**MUST:** una `deleteClock` storica dopo recreation può essere rimossa solo con la stessa prova.

**MUST:** wall clock/lease decide soltanto membership e fencing. Non sostituisce la copertura causale.

**MUST:** il riuso di uno slot incrementa `generation` e mantiene la sequence almeno al massimo già osservato per quella coordinata.

**MUST:** business write, `_sync.writer` e avanzamento `lastSeq` sono atomici nella stessa transazione Firestore.

Le Security Rules rendono autorevoli membership, generation e lease tramite `request.time`. Il contenuto del checkpoint è calcolato dal client soltanto dopo full scan ed è un'invariante del protocollo/test, non una read-proof crittografica verificabile dalle Rules.

### Empty shell dopo terminal GC

Il client non esegue delete fisiche dei documenti di sync. Se business state e `fields` diventano vuoti dopo stable-frontier GC, `transactionWriter` persiste un empty shell con `_schemaVersion` e `_sync.writer`. Le Rules negano sempre la delete fisica mensile lato client; la cancellazione fisica resta esclusivamente nel boundary trusted di account deletion.

Questo impedisce che una vecchia generation trasformi una delete Firestore non attribuita in una transizione causale. La cancellazione account trusted/Admin resta separata e può rimuovere fisicamente i documenti.
## Gate

Il gate canonico del repository è:

```bash
npm run verify:m8
```

`npm run test:gc` resta la suite causale dedicata; non sostituisce il gate completo.
