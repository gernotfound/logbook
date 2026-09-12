# LogBook — istruzioni operative per agenti AI

Ultimo aggiornamento: 2026-09-09 | Progetto: app PWA fitness tracking (allenamento, nutrizione, misurazioni corporee).

## Convenzioni

Ogni regola in questo documento è classificata:

- **MUST:** Requisito non negoziabile. Violarlo può causare bug, perdita dati o problemi di sicurezza.
- **SHOULD:** Preferenza forte. Derogare solo con motivazione esplicita nel piano.
- **VERIFY:** Controllare codice o dashboard prima di assumere che sia vero.
- **NOTE:** Contesto storico o informativo, non istruzione esecutiva.

## Fonte di verità

1. Il codice e la configurazione effettivamente letti sono la fonte di verità operativa.
2. `AGENTS.md` descrive invarianti e procedure.
3. Se documentazione e codice sono in conflitto, segnalare il conflitto e non modificare codice alla cieca.
4. **MUST:** Non dichiarare mai di aver letto un file se il tool non ne ha restituito il contenuto.

## Stack e file canonici

### Stack tecnologico

- **Framework:** React 19 + Vite 8 + TypeScript 7
- **Hosting:** Vercel (deploy automatico, radice `/`)
- **State management:** Zustand 5 (`src/store/useAppStore.ts`)
- **Validazione runtime:** Zod 4 (`src/lib/schema.ts`, `src/lib/schemas/*.ts`)
- **Persistenza:** IndexedDB (`idb-keyval`), `localStorage` sincrono, Firestore cloud
- **Backend:** Firebase Modular SDK v12 (`firebase/firestore`, `firebase/auth`, `firebase/analytics`, `firebase/app-check`)
- **Styling:** CSS nativo (variabili in `src/styles/global.css`). **MUST:** No Tailwind.
- **Icone:** `lucide-react`
- **PWA:** `vite-plugin-pwa`
- **Monitoring:** `@vercel/analytics`, `@vercel/speed-insights`, Google Analytics (`firebase/analytics`)
- **Librerie:** `date-fns`, `fast-deep-equal`, `chart.js` + `react-chartjs-2`, `fuse.js`, `react-virtuoso`
- **Testing:** `vitest` + `@testing-library/react` (unit/integration), Playwright (E2E), `oxlint` (linting), Snyk (sicurezza)

### File canonici — invariante di modifica

Per ogni nuova chiave cloud-root, MUST verificare e aggiornare:

| File | Responsabilità |
|---|---|
| `src/types.ts` | Definizione del tipo |
| `src/lib/schema.ts`, `src/lib/schemas/*.ts` | Schema Zod |
| `src/contexts/AuthContext.tsx` | Gestione autenticazione e merge |
| `src/lib/db.ts` | Persistenza e mapping Firestore |
| `firestore.rules` | Regole di sicurezza |
| `tests/firestore_security_rules.test.ts` | Test delle regole |
| Logica di merge/import-export | `src/lib/merge.ts`, `src/lib/export.ts` |

Violare questa invariante causa la **perdita silenziosa** dei dati al primo ciclo di salvataggio/caricamento.

Prima di modificare: classificare il dato come effimero, locale persistito, cloud-root oppure mensilizzato.

## Stato, storage e sincronizzazione

Ruoli dei livelli di storage:

| Livello | Ruolo |
|---|---|
| **Zustand** | Stato operativo in memoria, single source of truth per React |
| **IndexedDB** (`idb-keyval`) | Persistenza locale principale di `UserData` |
| **`localStorage`** | Persistenza sincrona: `localWorkout`, guest, tab, timer, bozze |
| **Firestore** | Replica remota e sincronizzazione cloud |

- **MUST:** Offline, l'app deve avviarsi e operare dai dati locali.
- **MUST:** Una write rifiutata non deve essere esposta come confermata. La sincronizzazione tramite `replicateJournal` e transazioni gestisce gli esiti e mantiene i dati se offline.
- **MUST:** Le funzioni di aggiornamento devono rigettare la Promise se la persistenza fallisce. Vietato risolvere silenziosamente nel `catch`.
- **MUST:** Il PWA reload barrier (`prepareForReload`) deve essere fail-safe: se `userData` esiste in memoria ma `envelope` è nullo o illeggibile, la sessione deve essere considerata *unsafe* (non salvata) per prevenire perdita di dati. Non autorizzare il reload alla cieca.

### `permission-denied` — gestione per contesto

| Contesto | Comportamento richiesto |
|---|---|
| Sincronizzazione (`replicateJournal`) | MUST: gestire e propagare stati di errore (`rejected`). Non mascherare. |
| Bootstrap App Check | MAY: retry limitato, solo se la causa transitoria è identificata. |
| Telemetria | MAY: best-effort, può non propagare l'errore alla UI, ma deve registrare localmente il fallimento. |
| `deleteAccount` | MUST: comunicare all'utente se la cancellazione cloud è parziale. |

→ Dettagli completi: `docs/storage-and-sync.md`

## Dati e validazione

- **MUST:** Tutti i dati in ingresso (Firestore, IndexedDB) devono transitare attraverso `UserDataSchema.parse()`.
- **MUST:** Nessun `undefined` nei payload Firestore. Ogni campo opzionale usa `null` o chiave omessa, mai entrambi per lo stesso campo.
- **SHOULD:** `.passthrough()` sui sub-schema Zod solo dove la compatibilità in avanti è intenzionale.
- **NOTE:** I sub-schema sanitizzano gli elementi con `id` valido ma campi corrotti, preservando la referenza.

### Merge guest/cloud

- Array con ID: unione deduplicata, priorità guest in caso di collisione.
- Record per data (`nutrition`): unione date, merge sotto-array per `id`.
- Scalari: priorità guest se valorizzati.
- **MUST:** Il risultato deve superare `UserDataSchema.parse()` prima del salvataggio.
- **NOTE:** La policy "guest wins" non equivale a "dato più recente".
- **VERIFY:** Leggere implementazione e test prima di cambiare la logica di merge.

→ Dettagli completi: `docs/data-model-and-zod.md`

## Workout, timer e date

### `localWorkout` vs `activeWorkout`

| Campo | Storage | Scopo |
|---|---|---|
| `localWorkout` | `localStorage` + Zustand | Sessione in corso del dispositivo. Non sovrascrivibile da fetch cloud. |
| `activeWorkout` | Firestore (campo nel documento utente) | Snapshot cloud del workout attivo. |

- **MUST:** Un fetch cloud non deve sovrascrivere `localWorkout` attivo.
- **MUST:** Su `visibilitychange === 'hidden'`, salvare `localWorkout` sincronamente in `localStorage`, bypassando il debouncer.
- **MUST:** Proteggere `JSON.stringify` e `localStorage.setItem` con `try/catch`.

### Timer di recupero (`WorkoutTimer.tsx`)

- **MUST:** Mai usare `setInterval` puro (throttling in background su mobile).
- Il timestamp iniziale `Date.now()` è memorizzato in `localStorage` e il delta viene ricalcolato a ogni tick e al ritorno dal background.

### Gestione date

- **MUST:** Date giornaliere utente: `YYYY-MM-DD` locale tramite `Logic.getLocalDateString()`.
- **MUST:** Non usare `toISOString().slice(0, 10)` per la data locale (sfasa la mezzanotte).
- Timestamp evento/audit: UTC o epoch.
- Mese Firestore: derivato dalla data locale della registrazione.

### Edge case (già gestiti nel codice)

- **NOTE:** `routineCount === 0` → `getNextScheduledRoutine` restituisce `null` (nessuna divisione per zero).
- **NOTE:** Velocità cardio: calcolata solo se `time > 0` e `distance` valida.

## Sicurezza e configurazione

### Variabili d'ambiente

- **MUST:** Tutte le 8 variabili `VITE_FIREBASE_*` devono essere presenti e non vuote; il fail-fast in `src/lib/firebase.ts` lancia `Error` se mancano.
- **MUST:** Accesso statico `import.meta.env.VITE_*`. Mai accesso dinamico con `import.meta.env[key]`.
- **VERIFY:** `VITE_FIREBASE_DATABASE_URL` è nel fail-fast ma il progetto usa solo Firestore, non Realtime Database. Potrebbe essere rimossa.

### App Check

- Provider: `ReCaptchaEnterpriseProvider` (NON `ReCaptchaV3Provider`).
- `isSupported` non esiste per `firebase/app-check`; check manuale su `window.crypto` e `window.fetch`.

### Domini e CSP

- **MUST:** Se si cambia dominio di hosting, autorizzare in Firebase Auth e Google Cloud Console.
- **MUST:** Non rimuovere i domini Firebase/Vercel dalla CSP in `vercel.json`.

### Firestore Rules

- **MUST:** Dopo ogni modifica a `firestore.rules`, eseguire: `npx firebase-tools deploy --only firestore:rules`.
- **MUST:** `service-account.json` è nel `.gitignore` e non va mai committato.

→ Dettagli completi: `docs/firebase-config.md`

## Design system e UX

### Tema

Dark glassmorphism governato da `src/styles/global.css`. Variabili CSS, classi standard e sentence case italiano.

- **MUST:** Prestare massima attenzione alla sintassi CSS (chiusura corretta di tutte le parentesi graffe `}`). Un errore di sintassi silenzioso corrompe l'intera interfaccia senza far fallire la build.
- **MUST:** Durante il refactoring delle variabili CSS (es. estraendo in `tokens.css`), verificare minuziosamente che TUTTE le variabili originali usate nel codice (es. `--primary-dark`) siano migrate e presenti, per evitare fallback errati del browser (es. testo nero su nero).

→ Dettagli completi: `docs/design-system.md`

### Vincoli UX mobile

- **MUST:** Niente `<dialog>` per form/editor complessi; usare vista inline/full-screen o accordion.
- **MUST:** Usare `GlobalDialog` (`useDialogStore`), mai `window.alert`/`window.confirm`.
- **MUST:** Input a `font-size: 16px !important` per prevenire zoom iOS.
- **SHOULD:** `min-width: 0` nei figli flex soggetti a overflow.
- **MUST:** Touch target principali almeno 44x44px.
- **SHOULD:** Menu contestuali con `ContextMenu.tsx` invece di bottoni inline.
- **VERIFY:** Test manuale su iOS Safari/PWA e viewport stretti.

### Anti-pattern React

- **MUST:** MAI usare l'attributo HTML `hidden={...}` sui figli di un componente `<Suspense>` in React 18 (o sullo stesso Suspense). React usa internamente `hidden` per gestire le transizioni offscreen, e sovrascriverlo causa conflitti e blocchi permanenti del rendering (schermate vuote). Usare sempre `style={{ display: condizione ? 'block' : 'none' }}`.
- **MUST:** Mai fallback inline per array/oggetti nei selettori Zustand (es. `state.dati || []` crea referenza nuova a ogni render). Usare costanti condivise stabili dichiarate fuori dal componente.
- **SHOULD:** `React.memo` con comparatore custom nei componenti ad alta frequenza (`SessionExerciseCard`, `SessionSetRow`), solo dopo profiling.

### Feedback immediato

- **MUST:** Nessuna azione "cieca". Ogni interazione (Aggiungi, Salva, Elimina) deve avere riscontro visivo istantaneo nella stessa schermata (toast, aggiornamento ottimistico, svuotamento input).

## Processo di modifica

### Ispezione prima della modifica

- **MUST:** Leggere i file coinvolti e cercare simboli, implementazioni e test correlati prima di proporre modifiche.
- **MUST:** Usare gli strumenti di ricerca e lettura disponibili. Se un file non è leggibile, dichiararlo.
- **MUST:** Prima di aggiungere un elemento (banner, form, logica), verificare nel codebase che non sia già presente.

### Strict Planning Mode

Per modifiche strutturali, dati, sync, sicurezza, dipendenze o multi-file:

1. Preparare un piano (`implementation_plan.md`) con obiettivo, file coinvolti, rischi, test e rollback.
2. Richiedere approvazione esplicita dell'utente.
3. Modificare il repository solo dopo approvazione.

**NOTE:** Per fix locali e minor, una procedura più breve è accettabile, ma l'agente non deve scrivere su repository senza autorizzazione per modifiche strutturali.

### Commenti nel codice

- **SHOULD:** Commentare decisioni non ovvie, workaround, vincoli esterni e rischi di regressione.
- **MUST:** Non aggiungere commenti che ripetono ciò che il codice esprime già.

## Test e deploy

### Checklist obbligatoria

Per ogni modifica al codice, eseguire in sequenza:

```bash
npm run lint        # oxlint
npm run test        # vitest run (unit + integration)
npm run build       # tsc --noEmit && vite build
npm run test:e2e    # playwright test (se cambiano UI, flussi, testo o routing)
```

- **MUST:** Non dichiarare test superati se non sono stati eseguiti.
- **MUST:** Ogni modifica deve passare silenziosamente lint, test e build.
- **VERIFY:** Se si modificano testi, placeholder o selettori dell'interfaccia, cercare in `e2e/` se compaiono nei test Playwright e aggiornarli.

### Bundle size

- **SHOULD:** Dopo `npm install` di nuove dipendenze, eseguire `npm run analyze`. Se la dipendenza supera ~50 KB gzip, avviare review con l'utente.

### Vercel Deployment

- **VERIFY:** Deployment Checks è attivo nella dashboard Vercel.
- **VERIFY:** I workflow GitHub Actions (Unit/E2E tests) esistono e riportano status.
- **MUST:** Non assumere che ogni push sia bloccato dai check finché la configurazione non è stata controllata.
- L'app gira sulla radice `/` del dominio (`base: '/'` in `vite.config.ts`).

### Encoding

- **MUST:** Tutti i file Markdown e sorgente sono UTF-8 senza BOM.
- **MUST:** Non introdurre mojibake (sequenze come A-grave corrotta, caratteri sostitutivi Unicode e simili).
- **VERIFY:** Dopo modifiche con copy/paste, controllare accenti, apostrofi, frecce e simboli.

## Riferimenti

Documentazione di dettaglio in `docs/`:

| Documento | Contenuto |
|---|---|
| [`docs/storage-and-sync.md`](docs/storage-and-sync.md) | Architettura storage, pipeline di salvataggio, merge, blindatura background |
| [`docs/firebase-config.md`](docs/firebase-config.md) | Variabili d'ambiente, App Check, Firestore Rules, CSP, domini |
| [`docs/data-model-and-zod.md`](docs/data-model-and-zod.md) | UserData, Zod gateway, ghost objects, invarianti di modifica |
| [`docs/catalog-operations.md`](docs/catalog-operations.md) | Catalogo globale, seeding, seed vuoti, recovery |
| [`docs/design-system.md`](docs/design-system.md) | Tema dark glassmorphism, variabili CSS, tipografia, sentence case |
| [`docs/account-lifecycle.md`](docs/account-lifecycle.md) | Export CSV, eliminazione account, logout, modalità guest |
