# Operazioni Catalogo Globale — TheLogBook

**Quando leggere:** cache catalogo, esercizi/alimenti, seeding, versioni manifest e rollback.
**Non inferire:** seed bundled vuoto è intenzionale; dry-run non è pubblicazione e versione catalogo non coincide con release PWA.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Struttura Firestore — `global_catalog`

Il manifest indica i documenti dati della versione pubblicata; `exercises_v1` e `foods_v1` sono anche i riferimenti nominali del seed bundled, non un fallback da imporre a ogni pubblicazione. La forma è:

| Documento | Contenuto |
|---|---|
| `manifest` | Versione, data aggiornamento, `schemaVersion`, `docRefs` (punta ai documenti dati), `itemCounts` |
| valore di `docRefs.exercises` | `{ items: [...] }` — esercizi della versione pubblicata |
| valore di `docRefs.foods` | `{ items: [...] }` — alimenti della versione pubblicata |

### Regole Firestore

`global_catalog` consente al client soltanto `get` pubbliche di singoli documenti della collezione (`manifest` e riferimenti versionati). Query/`list`, accessi a sottocollezioni e scritture sono negati: il catalogo non richiede enumerazione e i documenti storici non devono essere scoperti tramite query. Questa restrizione riduce la superficie di abuso, **non** impedisce richieste ripetute a un documento noto né sostituisce App Check o i limiti di quota.

## Seed locali vuoti — policy "enforce manual input"

I file `src/lib/catalog/seedExercises.json` e `src/lib/catalog/seedFoods.json` sono **intenzionalmente vuoti**. L'app impone l'inserimento manuale o il download dal cloud per ridurre il bundle size.

### Fallback offline

Se `global_catalog/manifest` non è raggiungibile, il `CatalogService` cade sul seed locale secondo il proprio boundary. Essendo quest'ultimo vuoto, il fallback restituisce **array vuoti validi**, non un catalogo popolato. L'app non va in crash e i `customItems` dell'utente continuano a funzionare. Un'eccezione di lettura IndexedDB viene ritentata una volta; se fallisce nuovamente, il seed è soltanto un fallback temporaneo in memoria, senza sovrascrivere la cache esistente su disco. Un accesso successivo può riprovare a leggere la cache.

## Script di seeding (`scripts/seed-catalog.mjs`)

Lo script pubblica versioni del `global_catalog` su Firestore usando input JSON espliciti.

### Validazione e dry-run

Lo script rifiuta array vuoti, ID assenti/duplicati, nomi vuoti, macronutrienti non numerici/negativi e documenti JSON oltre 800.000 byte. La validazione/dry-run avviene prima dell'inizializzazione Firebase Admin.

Con i seed bundled correnti vuoti, quindi, il comando fallisce in validazione **prima di poter scrivere**. Non documentare il contrario: la protezione contro un catalogo vuoto è intenzionale e deve restare testata.

**MAY:** eseguire `--dry-run` è il percorso raccomandato per validare file esterni e deve rimanere non distruttivo.

Esempio sicuro:

```bash
node scripts/seed-catalog.mjs --dry-run --project=demo-logbook-audit --version=test-1 --exercises=/percorso/esercizi.json --foods=/percorso/alimenti.json
```

### Pubblicazione reale

Progetto e versione sono obbligatori. Una scrittura richiede inoltre `--confirm` uguale al progetto indicato. Il service account opzionale deve appartenere allo stesso progetto; il file resta escluso da Git. Non esiste un progetto di produzione hardcoded.

**MUST:** una pubblicazione reale non usa i seed bundled vuoti. Deve ricevere input esterni espliciti, validi e non vuoti, superare prima la validazione/dry-run e puntare a un progetto verificato.

**MUST:** non indebolire i guardrail `--project`, `--version`, `--confirm`, non-empty validation o project-match per rendere più comodo il seeding.

La pubblicazione crea `exercises_<versione>` e `foods_<versione>`, conserva l'eventuale manifest precedente in `previous_manifest_<versione>` e aggiorna il manifest in un'unica transazione. Il riuso di una versione esistente fallisce: i documenti letti dai client precedenti non vengono sovrascritti.

Il percorso di scrittura richiede una verifica isolata con Admin SDK reale prima dell'uso operativo. I test correnti coprono validazione, dry-run e ordine delle scritture di una transazione simulata con mock; non verificano una pubblicazione su Firestore reale. L'assenza di un test end-to-end contro produzione non autorizza a saltare i guardrail.

Per il rollback, dopo verifica dei documenti referenziati, ripristinare il manifest archiviato mediante una procedura amministrativa approvata. Non cancellare i documenti delle versioni precedenti mentre possono essere letti da client ancora attivi.

## Freschezza e pubblicazione nel client

Il numero del catalogo/manifest è indipendente dalla release PWA e non va incrementato per un bump di `package.json`. La sola versione non certifica una cache completa: il client confronta anche schema, riferimenti e conteggi. Il seed locale con versione `1.0.0` non impedisce il download di un manifest popolato con la stessa versione. Documenti mancanti, conteggi diversi e ID non validi/duplicati mantengono la cache precedente senza marcarla aggiornata; una successiva sincronizzazione può riprovare. I download concorrenti nello stesso contesto JavaScript condividono un'unica richiesta tramite `syncInFlight`; non è prevista una deduplicazione tra schede o dispositivi distinti.

Durante `DB.loadCloudPayload()`, la verifica remota del catalogo e la lettura del documento root Firestore vengono avviate in parallelo. Prima di risolvere la libreria e pubblicare lo stato idratato, il caricamento attende l'esito del catalogo: quando sono arrivati nuovi esercizi/alimenti li usa immediatamente, evitando uno stato UI costruito da una cache precedente.
Offline, in caso di timeout o errore remoto, usa il catalogo locale/seed; non scrive alcuna modifica di catalogo nel journal dell'utente. La modalità guest continua a utilizzare la cache locale senza avviare da sola letture Firestore, come previsto dalla policy di accesso ospite. I client già aperti verificano la freschezza durante le normali hydration (incluso il ritorno in foreground), senza listener realtime.
`persisted: false` indica che l'aggiornamento remoto è disponibile in memoria ma il salvataggio IndexedDB è fallito; `updated: true` da solo non attesta durata dopo il riavvio. Gli omonimi con ID distinti restano visibili; su collisione di ID il custom locale ha precedenza. I test `guest_bootstrap_lifecycle` e `training_exercises_library_ui` verificano i percorsi guest e di ripristino esercizi con una cache persistita e memoria inizialmente vuota; non certificano invece il comportamento su dispositivi reali o tutte le gare multi-scheda.

## Boundary catalogo locale e adapter remoto (18/11/2026)

`src/lib/catalog/catalogService.ts` gestisce soltanto cache IndexedDB,
memoria, seed bundled e validazione degli oggetti del catalogo, senza import
Firebase né richieste HTTP. Le letture Firestore di manifest e documenti
versionati restano temporaneamente isolate in
`src/lib/catalog/firestoreCatalogAdapter.ts` e sono richiamate dal
loader cloud legacy `src/lib/db.ts`. L'adapter mantiene timeout totale,
coalescing, controllo degli ID e dei macronutrienti e pubblicazione
di cache soltanto dopo la validazione; il fallback locale non inventa
esercizi o alimenti se i seed bundled sono vuoti.

**MUST:** i test che verificano il loader cloud devono intercettare
l'adapter remoto direttamente, senza fingere che il servizio cache
esporti ancora `syncGlobalCatalog`; i test del guest e dell'offline
non richiedono Firebase per la sola lettura del catalogo. Sostituire
l'adapter con un'origine non-Firebase soltanto dopo aver verificato
integrità e pubblicazione del catalogo nella nuova architettura.

## Candidato Static Assets Cloudflare — CF-04 (26/11/2026)

`scripts/build-static-catalog.mjs` prepara, **senza pubblicare**, un
pacchetto statico da due file JSON espliciti e non vuoti. Il comando
`npm run catalog:static:prepare -- --dry-run --version=candidate-1
--updated-at=2026-11-26T10:00:00.000Z --exercises=... --foods=...`
valida gli input e mostra manifest e riferimenti senza scrivere file.
Per produrre un pacchetto **in una nuova directory di staging** occorrono
anche `--out-dir=...` e `--confirm-version=candidate-1`; una directory
esistente viene rifiutata. Le due risorse immutabili vengono scritte
prima di `manifest.json`. Un output parziale dopo un errore I/O **non**
è pubblicabile e deve essere scartato/ripreparato, mai recuperato
interpretando un file incompleto come manifest valido.

Il manifest JSON mantiene `schemaVersion=1`, `docRefs` e `itemCounts` e
aggiunge `digests` SHA-256. I riferimenti sono nomi di file
`<tipo>_<versione>_<sha256>.json`; ciascun file contiene `{ "items": [...] }`.
Il formato non trasforma versioni di release PWA in versioni catalogo.
L'adapter `src/lib/catalog/staticCatalogAdapter.ts` è un **candidato non
montato**: legge `/catalog/manifest.json` senza cache HTTP e i documenti
versionati dalla stessa origin senza credenziali, controlla nomi,
impronte sui byte esatti, tipo di risposta, dimensioni, conteggi,
identità e macronutrienti prima di aggiornare IndexedDB. Errori,
offline, timeout o contenuti HTML restituiti al posto di JSON conservano
il catalogo locale completo. `persisted: false` mantiene il significato
di aggiornamento disponibile in memoria ma non durevole.

**MUST prima dell'attivazione:** verificare provenienza, licenze e
contenuto del catalogo reale non vuoto; predisporre e revisionare
gli asset immutabili in `public/catalog/` conservando quelli ancora
referenziati; pubblicare il manifest solo dopo i file; verificare su
origin Cloudflare risposte JSON, cache header, digest e fallback PWA;
infine sostituire il solo chiamante compatibile e provare guest,
account Kinde e offline/Safari. Il candidato non introduce dati nel
deploy corrente, non modifica Firestore e non fornisce ancora un
catalogo pubblico. Un rollback ripunta il manifest a file storici
effettivamente presenti: non sovrascrivere file immutabili per lo stesso
nome né cancellare versioni ancora referenziate.
