# Operazioni Catalogo Globale — LogBook

> Stato: implementazione locale in verifica | Ultima verifica: 2026-09-11 | Nessun seeding o deploy eseguito durante la correzione dell'audit.

## Struttura Firestore — `global_catalog`

Il manifest punta ai documenti dati della versione corrente. I path legacy sono:

| Documento | Contenuto |
|---|---|
| `manifest` | Versione, data aggiornamento, `schemaVersion`, `docRefs` (punta ai documenti dati), `itemCounts` |
| `exercises_v1` | `{ items: [...] }` — tutti gli esercizi del catalogo |
| `foods_v1` | `{ items: [...] }` — tutti gli alimenti del catalogo |

### Regole Firestore

`global_catalog` ha `allow read: if true` (pubblico in sola lettura) e `allow write: if false` (nessuna scrittura da client).

## Seed locali vuoti — policy "enforce manual input"

I file `src/lib/catalog/seedExercises.json` e `src/lib/catalog/seedFoods.json` sono **intenzionalmente vuoti**. L'app impone l'inserimento manuale o il download dal cloud per ridurre il bundle size.

### Fallback offline

Se `global_catalog/manifest` non è raggiungibile, il `CatalogService` cade silenziosamente sul seed locale. Essendo quest'ultimo vuoto, il fallback restituisce **array vuoti validi**, non un catalogo popolato. L'app non va in crash e i `customItems` dell'utente continuano a funzionare.

## Script di seeding (`scripts/seed-catalog.mjs`)

Lo script popola `global_catalog` su Firestore usando i seed locali.

### Validazione e pubblicazione

Lo script rifiuta array vuoti, ID assenti/duplicati, nomi vuoti, macronutrienti non numerici/negativi e documenti JSON oltre 800.000 byte. Non carica credenziali o Admin SDK durante validazione e dry-run. I seed bundled attuali causano pertanto un errore esplicito, senza inizializzare Firebase.

Progetto e versione sono obbligatori. Una scrittura richiede inoltre `--confirm` uguale al progetto indicato. Il service account opzionale deve appartenere allo stesso progetto; il file resta escluso da Git. Non esiste più un progetto di produzione hardcoded.

```bash
node scripts/seed-catalog.mjs --dry-run --project=demo-logbook-audit --version=test-1 --exercises=/percorso/esercizi.json --foods=/percorso/alimenti.json
```

La pubblicazione crea `exercises_<versione>` e `foods_<versione>`, conserva l'eventuale manifest precedente in `previous_manifest_<versione>` e aggiorna il manifest in un'unica transazione. Il riuso di una versione esistente fallisce: i documenti letti dai client precedenti non vengono sovrascritti. Il percorso di scrittura richiede una verifica isolata con Admin SDK prima dell'uso operativo; i test attuali coprono validazione e dry-run.

Per il rollback, dopo verifica dei documenti referenziati, ripristinare il manifest archiviato mediante una procedura amministrativa approvata. Non cancellare i documenti delle versioni precedenti mentre possono essere letti da client ancora attivi.

## Freschezza e pubblicazione nel client

La sola versione non certifica una cache completa: il client confronta anche schema, riferimenti e conteggi. Il seed vuoto con versione `1.0.0` non impedisce il download di un manifest popolato con la stessa versione. Documenti mancanti, conteggi diversi e ID non validi/duplicati mantengono la cache precedente senza marcarla aggiornata; una successiva sincronizzazione può riprovare. I download concorrenti condividono un'unica richiesta.

Il caricamento utente attende l'esito del catalogo insieme al documento profilo, quindi risolve esercizi/alimenti con la stessa versione prima della pubblicazione dello stato. Offline resta il fallback locale. Gli omonimi con ID distinti restano visibili; su collisione di ID il custom locale ha precedenza. I test non dimostrano ancora tutti i percorsi guest e di ripristino dall'interfaccia.
