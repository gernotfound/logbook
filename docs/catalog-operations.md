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

## Seed locali (Popolati)

I file `src/lib/catalog/seedExercises.json` e `src/lib/catalog/seedFoods.json` sono **pienamente popolati** (oltre 2000 record). L'app garantisce l'accesso immediato e offline all'intero catalogo fin dalla prima installazione.

### Fallback offline

Se `global_catalog/manifest` non è raggiungibile (offline), il `CatalogService` cade silenziosamente sul seed locale e restituisce l'intero catalogo offline. I `customItems` dell'utente vengono fusi normalmente, garantendo operatività al 100%.

## Script di seeding (`scripts/seed-catalog.mjs`)

Lo script popola `global_catalog` su Firestore usando i seed locali.

### Stato attuale — PERICOLOSO

Lo script attualmente:
- Non controlla se `exercises.length === 0` o `foods.length === 0`
- Non richiede conferma esplicita
- Non ha flag `--confirm` o `--dry-run`
- Non esegue backup del manifest esistente

**MUST:** Usare con estrema cautela. Essendo i JSON locali ora popolati con migliaia di record, eseguirlo sovrascriverà l'intero catalogo cloud `global_catalog` su Firestore con la versione contenuta nei JSON locali, alterando le referenze per tutti gli utenti se gli ID non combaciano.

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
