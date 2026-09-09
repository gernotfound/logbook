# Ciclo di Vita Account — LogBook

> Stato: normativo | Ultima verifica: 2026-09-09 | File verificati: `src/lib/db/db_account.ts`, `src/lib/export.ts`, `src/contexts/AuthContext.tsx`, `src/lib/db.ts`

## Esportazione dati CSV

La funzione `Exporter.exportToCSV` in `src/lib/export.ts` genera due file CSV:

| File | Contenuto |
|---|---|
| `allenamenti.csv` | Dettaglio serie, dropset e isometrie |
| `misurazioni.csv` | Peso, calorie, macro e circonferenze corporee |

- **MUST:** I file CSV includono il Byte Order Mark UTF-8 (`\uFEFF`) per compatibilità con Microsoft Excel su Windows e Mac.
- **MUST:** Ogni nuova metrica o misurazione biometrica aggiunta all'app deve essere mappata in `src/lib/export.ts`.

## Eliminazione account

La procedura di eliminazione è in `src/lib/db/db_account.ts` (`deleteAccount`).

### Fasi dell'eliminazione

1. **Eliminazione dati cloud (paginata):**
   - Raccoglie tutti i documenti delle subcollection (`history_months`, `nutrition_months`, errori, eventi, anomalie).
   - Elimina in batch da 400 operazioni (limite Firestore: 500).
   - Elimina il documento utente principale `users/{uid}`.

2. **Eliminazione account Firebase Auth:**
   - Chiama `deleteUser(user)` per rimuovere l'account.

3. **Pulizia locale (nel `finally`):**
   - `purgeAllLocalUserData()` — cancella IndexedDB e localStorage.
   - `resetCache()` — resetta la cache interna.
   - `resetStore()` — resetta lo store Zustand.

### Problemi noti

**`permission-denied` durante eliminazione cloud:**
Attualmente, se un batch fallisce con `permission-denied`, il codice logga un `console.warn` e procede con `deleteUser`. Questo significa che:
- L'account Auth viene eliminato anche se i dati cloud non sono stati completamente rimossi.
- L'utente non viene informato che la cancellazione è parziale.

**MUST:** L'eliminazione account deve comunicare all'utente se la cancellazione cloud è parziale.

### Errore `auth/requires-recent-login`

Se l'utente non ha effettuato un login recente, Firebase Auth richiede una ri-autenticazione. L'errore viene intercettato e un messaggio chiaro viene mostrato all'utente.

## Logout sicuro

In `db.ts` (`secureLogOut`), durante la disconnessione:
- Viene cancellato `idb-keyval` (IndexedDB) e `localStorage` per garantire la privacy.
- **MUST:** Non eliminare la cache del Service Worker (`caches.delete()`). Contiene l'App Shell vitale per avviare l'app offline prima del login.

## Modalità Guest

La modalità guest è segnalata da `logbook_is_guest` in `localStorage`. Al collegamento di un account Google (`linkGoogleAccount`), i dati guest vengono fusi con quelli cloud tramite il merge deterministico descritto in `docs/storage-and-sync.md`.
