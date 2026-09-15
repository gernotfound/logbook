# M8 — Domain Operations V4 — Piano di esecuzione

Data: 15 settembre 2026  
Baseline: `main@4d6b5d1f306587c16ee15e3ddb7386a63c5b94bd`  
Stato: **approvato dall'utente**.

## Obiettivo

Introdurre un boundary esplicito e tipizzato per le mutazioni business senza sostituire il protocollo causale esistente.

Percorso target:

```text
UI/hook → DomainOperation → commit locale atomico → SemanticOperation → journal V4 → transactionWriter → Firestore
```

Il protocollo `SemanticOperation`, vector clock, tombstone, `$order`, active-workout guard e causal compaction restano il meccanismo di replica normativo.

## Versioni persistite

M8 non modifica:

- Data Schema: 1
- Sync Protocol: 1
- Local Envelope: 4
- Backup Schema: 3

“V4” identifica il layer Domain Operations sopra l'envelope corrente; le DomainOperation non vengono persistite come una nuova coda.

## Scope

Sono incluse operazioni tipizzate per:

- profilo;
- pianificazione nutrizionale;
- giornata nutrizionale, pasti, misurazioni, sonno e assunzioni integratori;
- libreria integratori;
- routine e relativo ordering/esercizi;
- cicli di allenamento, routine del ciclo e ciclo attivo;
- storico workout e completamento workout;
- active workout cloud snapshot e active pains;
- archivio esercizi/alimenti e catalog overrides;
- legal consent e risoluzione del conflitto nutrition planning.

Bootstrap, hydration, guest→account merge, import/restore e recovery restano boundary snapshot bulk.

## Implementazione

1. Aggiungere `domainOperations.ts` con discriminated union, reducer puro e compiler scope-limited verso `SemanticOperation`.
2. Aggiungere `commitDomainOperations()` a `localRepository.ts` con business state + journal atomici nello stesso update IndexedDB.
3. Aggiungere `dispatchDomainOperation()` allo store riutilizzando debounce, session epoch, `SyncResult` e remote writer correnti.
4. Migrare i consumer business ordinari.
5. Mantenere una allowlist minima per boundary snapshot bulk.
6. Aggiungere contract checker statico contro nuovi bypass.
7. Aggiungere test di equivalenza reducer ↔ semantic replay, identity/order fail-fast e durabilità/concorrenza IndexedDB.
8. Documentare il contratto normativo M8.
9. Definire `verify:m8` come estensione integrale di `verify:m7`.
10. Eseguire exact-head CI, aprire Draft PR, congelare HEAD e consegnare ad Antigravity.

## Rischi e contromisure

- **Divergenza reducer/projection:** test di equivalenza per famiglie di operation.
- **Identity ambigua:** fail-fast; nessun fallback automatico a snapshot array atomico.
- **Ordering:** riuso del payload `$order` già validato.
- **Crash tra UI e journal:** business state + semantic batch persistiti nello stesso update IndexedDB.
- **Regressione protocollo causale:** `transactionWriter`, `applySemanticOperations` e causal compaction non vengono sostituiti.
- **Bypass futuri:** checker statico hook/component.
- **Rollback:** nessun nuovo formato persistito; revert applicativo senza migrazione dati.

## Gate

Il criterio di handoff è:

```bash
npm run verify:m8
```

Il comando deve includere integralmente `verify:m7`. Solo dopo exact-head green viene aperta/congelata la Draft PR per Antigravity. Nessun merge prima del verdetto indipendente.
