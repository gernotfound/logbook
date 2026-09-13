# Storage e Sincronizzazione - LogBook

> Stato: normativo | Ultima verifica: 2026-09-13 | File verificati: src/store/useAppStore.ts, src/lib/sync/transactionWriter.ts, src/lib/sync/replicateJournal.ts, src/lib/sync/semanticProjection.ts, src/lib/sync/documentProjection.ts, src/constants.ts, src/main.tsx

## Architettura di storage

L'app utilizza quattro livelli di storage con ruoli distinti:

| Livello | Tecnologia | Ruolo | Dati principali |
|---|---|---|---|
| **Stato operativo** | Zustand 5 (useAppStore) | Stato in memoria, single source of truth per i componenti React | Tutto UserData, localWorkout, syncing, saveError |
| **Persistenza locale principale** | IndexedDB (idb-keyval) | Cache asincrona dell'intero albero UserData | Chiave 'logbook_cached_user_data' |
| **Persistenza sincrona** | localStorage | Dati che richiedono salvataggio sincrono istantaneo (sopravvive a suspend/kill del processo PWA) | logbook_local_workout, logbook_is_guest, logbook_activeTab, timer, bozze locali |
| **Replica remota** | Firestore (Firebase) | Sincronizzazione cloud, backup, condivisione cross-device | Documento utente + subcollection mensilizzate |

**MUST:** Offline, l'app deve avviarsi e operare dai dati locali (IndexedDB + localStorage).

## Pipeline di salvataggio Transazionale (Journaling e Semantic Merge)

La nuova pipeline sostituisce il precedente approccio basato sul debouncer e diffing globale introducendo un meccanismo a journal, proiezioni e Vector Clocks (Semantic Merge):

1. I componenti invocano saveUserData tramite le interfacce transazionali.
2. Viene creato un record nel journal locale. documentProjection.ts gestisce lo stato proiettato dei documenti, mentre semanticProjection.ts gestisce i diff deterministici per campo tramite Vector Clocks.
3. transactionWriter.ts processa queste mutazioni (SemanticOperation), preparandole per il cloud e assicurando l'atomicità lato client. Applica le estrazioni dei metadati dei Vector Clocks (_sync).
4. replicateJournal.ts replica in background il journal verso Firestore. In caso di offline, le mutazioni rimangono nel journal.
5. In caso di collisione o aggiornamento da altre fonti, il client idrata la base remota e proietta le operazioni pendenti (hydrateLocal in localRepository.ts), garantendo che il replay idempotente sia sempre deterministico basato sugli orologi vettoriali. I vecchi conflitti tridimensionali basati sull'intervento umano sono stati rimossi.

## Esiti della sincronizzazione

Il nuovo sistema replicateJournal / transactionWriter gestisce l'esito:

| Status | Significato |
|---|---|
| synced | Mutazioni applicate confermate su Firestore |
| rejected | permission-denied - la write è stata rifiutata (App Check, rules, dominio, auth). Il client registra il rigetto. |
| local-pending | Offline o timeout - transazione nel journal, Background Sync in attesa |
| failed | Errore critico non classificato |

**MUST:** Una write rifiutata (rejected) non deve mai essere esposta all'utente come confermata.

**MUST:** Le funzioni di salvataggio devono rigettare se l'accodamento della transazione locale fallisce in maniera critica. Vietato risolvere silenziosamente nel catch.

## Pre-render bootstrap

All'avvio dell'app (initApp in src/main.tsx), **prima** di createRoot().render():

1. La cache utente viene recuperata da IndexedDB e assegnata a window.__INITIAL_USER_DATA__.
2. Lo store Zustand viene inizializzato tramite getInitialUserData(), validando la cache con UserDataSchema.parse().

Questo elimina race condition con il ciclo di vita React e AuthContext:
- Impedisce il flash di schermate vuote o overlay di sync all'avvio offline.
- Evita la cancellazione distruttiva dei dati in modalità Guest.
- Evita la perdita dei dati locali durante il collegamento dell'account Google.

## Blindatura in background (Safari Suspend)

Quando document.visibilityState === 'hidden' (in useAppStore.ts):
1. Viene chiamato draftRegistry.flushAll() per salvare tutte le bozze.
2. localStorage.setItem('logbook_local_workout', JSON.stringify(state.localWorkout)) viene eseguito sincronamente, bypassando eventuali ritardi.
3. L'operazione è protetta da try/catch.

**Perché localStorage e non IndexedDB?** localStorage.setItem() è un'operazione sincrona bloccante che il browser garantisce prima di congelare il processo. IndexedDB si basa su transazioni asincrone che verrebbero abortite dall'OS.

## PWA Update Barrier

Il componente di ricarica della PWA (src/lib/sync/reloadBarrier.ts) regola gli aggiornamenti del Service Worker per prevenire la corruzione dei dati.
- **MUST:** Il reload barrier deve essere fail-safe. Se state.userData esiste in memoria ma il file persistito (envelope) è assente o corrotto, l'app deve bloccare l'aggiornamento (calcolando isUnsaved = true) perché il ricaricamento distruggerebbe lo stato in memoria che non è ancora salvato su disco in modo sicuro. Non assumere MAI isUnsaved = false solo perché manca envelope.

## Merge deterministico (Guest -> Cloud)

Al login con Google, se esistono dati guest locali, viene eseguito un merge deterministico (src/lib/merge.ts):

- **Array con ID**: unione deduplicata per id, priorità alle modifiche locali.
- **Record per data**: unione delle date YYYY-MM-DD, merge deduplicato dei sotto-array.
- **Campi scalari**: priorità ai dati guest se valorizzati, altrimenti cloud.

**MUST:** Il dato unificato deve transitare e superare UserDataSchema.parse() prima del salvataggio.

## Offline resilience

In assenza di connessione, l'app opera da IndexedDB locale con le mutazioni accumulate nel journal di replicateJournal.ts.
Quando la connessione viene ripristinata, il replicatore esegue in background il batch di operazioni pendenti, e i Vector Clocks riconciliano eventuali divergenze esterne deterministicamente.
