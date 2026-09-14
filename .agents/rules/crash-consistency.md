# Crash Consistency e Recovery - LogBook

> Stato: normativo da M3 | Baseline: `17fa94ce2c7b436b4b382f88acf05eddcb624efc`

## Obiettivo

La pipeline local-first deve rimanere recuperabile quando il processo viene interrotto o una singola boundary I/O fallisce. M3 non introduce una seconda coda o un secondo protocollo: rende verificabile il contratto già implicito in IndexedDB journal + semantic replay.

## Invarianti obbligatorie

### Local commit

`commitLocal()` usa una transazione IndexedDB atomica.

**MUST:** se la transazione locale fallisce, `data`, `actorSeq`, `clock` e `pending` precedenti restano invariati.

**MUST:** se la transazione locale riesce, il nuovo business state e le relative `SemanticOperation` diventano durevoli insieme prima del debounce cloud.

### Remote delivery

Firestore applica il batch semantico tramite transazione.

**MUST:** un failure prima del remote commit lascia il journal locale intatto e replayabile.

**MUST:** un remote commit completato non dipende dal completamento dell'ack locale per la propria correttezza.

### Lost acknowledgement

È lecito che Firestore abbia già committato mentre `acknowledgeThrough()` non riesce a persistere l'ack locale.

**MUST:** in questo caso la pending operation resta durevole e può essere reinviata.

**MUST:** `replicateJournal()` classifica il risultato come `local-pending` solo dopo aver riletto IndexedDB e verificato che almeno una operation interessata dall'ack fallito sia ancora presente nel journal. Se l'envelope è assente, corrotto, incompatibile o non conserva più la pending attesa, l'errore resta `failed`.

**MUST:** il replay della stessa operation non deve modificare nuovamente il business winner né produrre causal metadata differenti.

**MUST:** un successivo ack riuscito deve poter rimuovere la pending già applicata senza perdita di dati.

### Concurrent local edit durante remote -> ack

Un nuovo `commitLocal()` può completarsi mentre una generazione precedente è tra remote commit e local acknowledgement.

**MUST:** l'ack della generazione precedente rimuove solo operation con `seq <= expectedSeq`.

**MUST:** se `actorSeq` locale è già avanzato, `acknowledgeThrough()` non deve sostituire `data` con lo snapshot remoto più vecchio.

### Restart / hydration

Un reload può avvenire con journal non vuoto anche quando il remote commit corrispondente è già stato applicato.

**MUST:** `hydrateLocal()` conserva le pending esistenti e le riproduce sul causal state cloud osservato.

**MUST:** dopo hydration, il successivo journal replay converge allo stesso business + causal state del cloud già committato e può essere acknowledged.

### Session/process boundary

La memoria volatile (`running`, timeout, debounce) non è fonte di durabilità.

**MUST:** un nuovo process/session epoch deve poter riprendere esclusivamente dall'envelope owner-scoped persistito.

**MUST:** un risultato tardivo appartenente a un epoch precedente non deve mutare lo stato della sessione corrente.

**MUST:** il gate M3 comprende anche una prova Playwright che distrugge il document/JS realm, riapre l'app offline e verifica che `UserData` persistito nell'envelope IndexedDB sia ancora disponibile. La semantic replay correctness del journal autenticato resta verificata deterministicamente dalla recovery suite isolata.

## Fault injection

I test M3 in `tests/recovery/` devono usare failure deterministici, non timing casuale.

Sono boundary valide da iniettare:
- IndexedDB `put` prima del local journal commit;
- remote error prima del commit;
- IndexedDB `put` durante acknowledgement dopo remote commit;
- session/process epoch change tra local commit e replay;
- nuovo local commit tra remote commit e acknowledgement;
- hydration con pending già applicata remotamente.

I test che patchano primitive globali IndexedDB devono girare single-worker.

## Gate M3

Il gate normativo corrente è:

```bash
npm run verify:m3
```

Include integralmente i gate precedenti e aggiunge `npm run test:recovery` e `npm run test:e2e`. Per M3 e milestone successive, questo requisito supersede le vecchie formulazioni del gate minimo presenti nella documentazione M0/M1.

Un sottoinsieme verde non equivale al superamento di M3: il comando completo deve terminare con exit code 0.
