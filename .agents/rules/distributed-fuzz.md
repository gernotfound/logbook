# Distributed Property Fuzzing — LogBook

> Stato: normativo | Milestone: M2 | Baseline: M1 `1c3dce06745327d0622ab606afbb21ea0de906ad`

## Scopo

M2 aggiunge property-based / distributed fuzz testing alla pipeline di sincronizzazione causale. Il fuzzing non sostituisce i test deterministici M0/M1: genera molte varianti riproducibili degli stessi invarianti e deve fallire con un seed utilizzabile per una riproduzione esatta.

## Riproducibilità

La suite dedicata è:

```bash
npm run test:fuzz
```

Ogni scenario usa un PRNG deterministico interno. In caso di failure il report deve includere il seed. La riproduzione di un singolo caso usa:

```bash
LOGBOOK_FUZZ_SEED=<seed> npm run test:fuzz
```

Per cambiare il numero di casi senza cambiare la semantica dei generatori:

```bash
LOGBOOK_FUZZ_CASES=<n> npm run test:fuzz
```

**MUST:** nessun test fuzz può dipendere da `Math.random()`, dall'orologio o da ordine non deterministico esterno senza serializzare esplicitamente tale input nel seed/caso riproducibile.

## Invarianti M2

La suite deve esercitare almeno:

1. **Delivery-order convergence** — lo stesso insieme di mutation concorrenti deve produrre lo stesso business state e causal state indipendentemente dall'ordine di consegna.
2. **Batching convergence** — consegnare contender nello stesso batch o in batch separati deve convergere allo stesso `FieldStamp` oltre che allo stesso valore business.
3. **Retry idempotence** — la duplicazione/replay di operation già osservate non deve cambiare il risultato.
4. **Causal dominance** — una mutation causalmente successiva deve restare winner anche quando la rete consegna prima il discendente e poi gli eventi più vecchi.
5. **Repeated synchronization rounds** — round successivi che partono dal causal context convergente precedente devono restare convergenti sotto nuove modifiche concorrenti.
6. **Vector-clock algebra** — `mergeVectors` deve essere commutativo, associativo, idempotente e coprire causalmente ogni input.
7. **Projection round-trip** — per domini generati supportati, `diffDocuments(base, desired)` seguito da `applySemanticOperations(base, ops)` deve ricostruire il business state desiderato.

## Causal state, non solo business state

**MUST:** i test di convergenza confrontano sia `documents` sia `syncMetas`. Due repliche con lo stesso valore visibile ma `FieldStamp.clock` differenti non sono considerate convergenti, perché una mutation futura può risolvere diversamente il conflitto.

Quando più operation sullo stesso field vengono risolte nello stesso batch, il winner determina valore/tombstone e actor stamp, ma il causal clock risultante deve osservare tutti i contender già risolti. Questo rende il risultato indipendente dal confine artificiale dei batch di rete.

## Gate

Il gate M2 completo è:

```bash
npm run verify:m2
```

Include, nell'ordine: lint, suite base, isolated, fuzz, stress/challenger, emulator/rules, no-skips e build TypeScript/Vite.

`npm run verify:m0` resta disponibile come regression gate storico, ma non è sufficiente per approvare M2.

## Politica sui failure

Un seed che scopre una divergenza non deve essere semplicemente escluso. La classificazione ammessa è:

- production bug;
- generator bug / scenario impossibile secondo il protocollo;
- test oracle bug;
- infrastructure/flaky non deterministico.

Per production bug, aggiungere anche una regressione deterministica minima quando il caso può essere ridotto a una sequenza leggibile. Il seed originale può continuare a essere coperto dalla suite generativa.
