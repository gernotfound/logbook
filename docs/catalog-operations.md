# Operazioni Catalogo Globale — LogBook

> Stato: normativo | Ultima verifica: 2026-09-09 | File verificati: `scripts/seed-catalog.mjs`, `src/lib/catalog/catalogService.ts`, `src/lib/catalog/seedExercises.json`, `src/lib/catalog/seedFoods.json`, `firestore.rules`

## Struttura Firestore — `global_catalog`

La collezione `global_catalog` contiene tre documenti:

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

### Stato attuale — PERICOLOSO

Lo script attualmente:
- Non controlla se `exercises.length === 0` o `foods.length === 0`
- Non richiede conferma esplicita
- Non ha flag `--confirm` o `--dry-run`
- Non esegue backup del manifest esistente

**MUST:** Non eseguire MAI accidentalmente questo script. Poiché i JSON locali sono stati svuotati per la policy "enforce manual input", eseguirlo sovrascriverebbe `global_catalog` su Firestore con array vuoti, distruggendo il database cloud di esercizi e alimenti per tutti gli utenti.

### Protezioni raccomandate (task separato)

1. Aggiungere dry-run e validazione input
2. Aggiungere conferma esplicita per overwrite (`--confirm` flag)
3. Interrompersi con input vuoto (`items.length === 0`)
4. Backup del manifest esistente prima di sovrascrivere
5. Documentare procedura di recovery

### Utilizzo attuale

```bash
# Richiede service-account.json (NON committato, nel .gitignore)
node scripts/seed-catalog.mjs
```

Il file `service-account.json` va scaricato da Firebase Console (*Impostazioni progetto → Account di servizio → Genera nuova chiave privata*) e usato solo localmente.
