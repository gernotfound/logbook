# LogBook — istruzioni operative per agenti AI

Ultimo aggiornamento: 2026-09-20 | App: 1.1.0 | Progetto: PWA fitness tracking (allenamento, nutrizione, misurazioni corporee).

## Convenzioni

Ogni regola in questo documento è classificata:

- **MUST:** requisito non negoziabile. Violarlo può causare bug, perdita dati o problemi di sicurezza.
- **SHOULD:** preferenza forte. Derogare solo con motivazione tecnica esplicita.
- **VERIFY:** controllare codice, test o dashboard prima di assumere che sia vero.
- **NOTE:** contesto storico o informativo, non istruzione esecutiva.

## Fonte di verità e gestione del drift

1. Il repository GitHub `gernotfound/logbook`, al commit realmente letto, è la fonte di verità tecnica.
2. Prima di analizzare o modificare: controllare l'HEAD reale di `main`, leggere questo file, leggere le regole pertinenti in `.agents/rules/`, quindi cercare implementazione, chiamanti, tipi, test e configurazioni correlate.
3. `AGENTS.md` contiene gli invarianti trasversali; `.agents/rules/` contiene i contratti specialistici.
4. Se documentazione e codice divergono, non modificare il codice per farlo aderire alla cieca a una regola obsoleta. Discriminare il comportamento corretto con codice, test, history e configurazione; correggere la fonte normativa nello stesso task quando necessario.
5. Una regola documentale obsoleta non deve bloccare un upgrade tecnicamente corretto: va aggiornata o rimossa con evidenza e regressioni adeguate.
6. **MUST:** non dichiarare mai letto, testato, deployato o verificato ciò che non è stato realmente osservato.

## Classificazione del rischio

Classificare internamente ogni task almeno come STANDARD, SENSITIVE o CRITICAL.

Sono **CRITICAL** almeno: dati utente, IndexedDB/persistenza, sincronizzazione, Firestore e Security Rules, autenticazione, guest→account, schema/migrazioni, import/export, cancellazione account, PWA update/reload e qualunque percorso con rischio di perdita/corruzione dati o sicurezza.

- **MUST:** maggiore è il rischio, maggiore è la profondità di ricerca, test e review.
- **MUST:** risolvere la root cause, non applicare workaround locali che lasciano invarianti incoerenti.
- **MUST:** mantenere il diff minimo rispetto all'obiettivo e aggiungere test di regressione quando appropriato.

## Autonomia operativa

Quando il product owner autorizza a procedere, risolvere o completare un task, l'autorizzazione copre l'intero normale ciclo tecnico pertinente: analisi → root cause → branch → implementazione → test → commit → PR → correzione CI → review → merge → verifica post-merge → verifica Vercel.

Non richiedere una nuova approvazione per scelte di implementazione, test falliti, CI rossa, conflitti tecnici o correzioni necessarie lungo quel ciclo. Fermarsi solo se serve una vera decisione di prodotto/UX non deducibile, un'azione distruttiva/irreversibile sui dati utente non già autorizzata, oppure mancano permessi/strumenti indispensabili.

Per task strutturali o CRITICAL preparare un piano di lavoro prima delle modifiche. Il piano può vivere nel reasoning, nella descrizione PR o temporaneamente nel branch; non richiede una seconda autorizzazione dopo un mandato generale a procedere. Eventuali `implementation_plan*.md` task-specific sono artefatti temporanei e **MUST** essere rimossi prima del candidato finale, in accordo con `.agents/rules/ci-verification.md`.

## Stack e runtime correnti

- **Framework:** React 19 + Vite 8 + TypeScript 7.
- **Runtime CI/Vercel:** Node.js 24.x.
- **Hosting:** Vercel, frontend Vite/PWA alla radice `/`.
- **Boundary server trusted:** Vercel Functions native in `/api/` per Server Account Deletion; Firebase Admin è server-only.
- **State management:** Zustand 5 (`src/store/useAppStore.ts`).
- **Validazione runtime:** Zod 4 (`src/lib/schema.ts`, `src/lib/schemas/*.ts`).
- **Persistenza:** IndexedDB (`idb-keyval`), `localStorage` sincrono e Firestore cloud.
- **Backend client:** Firebase Modular SDK v12 (`firestore`, `auth`, `app-check`).
- **Styling:** CSS nativo modulare aggregato da `src/styles/global.css`, con token semantici in `src/styles/tokens.css`; **MUST:** niente Tailwind.
- **Icone UI:** `lucide-react`.
- **PWA:** `vite-plugin-pwa`; asset applicativi generati dalla pipeline `scripts/resize_icons.mjs` a partire dalla sorgente approvata.
- **Monitoring:** telemetria tecnica LogBook su Firestore, `@vercel/analytics`, `@vercel/speed-insights`. Google/Firebase Analytics non fa parte del prodotto.
- **Testing:** Vitest + Testing Library, Playwright E2E, Firebase Emulator, oxlint; `npm audit` è un gate workflow separato dal comando canonico M8.

## File canonici del modello dati

Per ogni nuova chiave cloud-root, MUST verificare e aggiornare dove applicabile:

| File | Responsabilità |
|---|---|
| `src/types.ts` | Tipo applicativo |
| `src/lib/schema.ts`, `src/lib/schemas/*.ts` | Gateway Zod |
| `src/lib/sync/documentProjection.ts` | Proiezione `UserData` → root/shard Firestore |
| `src/lib/sync/domainOperations.ts` e boundary correlati | Mutazioni business tipizzate |
| `src/contexts/AuthContext.tsx` | Auth, hydration e merge |
| `src/lib/db.ts` e moduli DB correlati | Lettura/scrittura Firestore |
| `firestore.rules` | Autorizzazione e validazione server-side |
| `tests/firestore_security_rules.test.ts` | Regressioni Rules |
| `src/lib/merge.ts`, `src/lib/export.ts` e boundary backup | Merge/import/export |

Prima di modificare un dato, classificarlo come effimero, application/local-only, cloud-root oppure mensilizzato. `UserData` applicativo non coincide automaticamente con il documento root Firestore.

→ Contratto completo: `.agents/rules/data-model-and-zod.md`.

## Storage, persistenza e sincronizzazione

| Livello | Ruolo |
|---|---|
| **Zustand** | Stato operativo in memoria, source of truth per React |
| **IndexedDB** | Persistenza locale principale: Local Envelope V4 + journal semantico |
| **`localStorage`** | Persistenza sincrona/device-critical, preferenze e code boundary-specific |
| **Firestore** | Replica remota e sincronizzazione cloud |

Versioni persistite correnti e indipendenti: Data Schema 1, Sync Protocol 1, Local Envelope 4, Backup Schema 3. Non incrementare una dimensione per compensare modifiche in un'altra.

- **MUST:** offline l'app deve potersi avviare e operare dai dati locali.
- **MUST:** le normali mutazioni business UI/hook attraversano Domain Operations. Snapshot-save è riservato ai boundary bulk/compatibility allowlisted.
- **MUST:** IndexedDB e journal vengono aggiornati atomicamente prima della replica cloud.
- **MUST:** una write Firestore rifiutata non deve essere esposta come confermata.
- **MUST:** le Promise di persistenza critica rigettano in caso di failure; vietato trasformare un errore critico in successo silenzioso.
- **MUST:** il reload barrier è fail-safe: dati in memoria senza envelope leggibile = sessione unsafe, quindi niente reload automatico.
- **MUST:** una conferma cloud attraverso `acknowledgeThrough()` elimina solo le operation con `seq <= expectedSeq`, assorbe il causal context remoto e rigioca sullo snapshot remoto soltanto le operation locali ancora pending. Una modifica locale avvenuta fra remote commit e acknowledge non può essere sovrascritta da uno snapshot remoto stantio.
- **MUST:** una classificazione `local-pending` dopo un possibile lost-ack richiede evidenza che l'intero batch consegnato sia ancora presente nel journal; stato assente/corrotto/parziale è failure, non pending sicuro.

### Accesso browser storage

`src/lib/sync/browserStorage.ts` distingue accessi strict e best-effort.

- **MUST:** gate di sicurezza/lifecycle che devono distinguere “chiave assente” da “storage illeggibile” usano il boundary strict e propagano/classificano l'errore.
- **MAY:** hint, preferenze e code best-effort possono degradare in modo conservativo secondo il loro contratto.
- **MUST:** non estendere automaticamente la semantica best-effort a logout, account deletion, reload barrier, ownership o altre invarianti CRITICAL.

→ Dettagli: `.agents/rules/storage-and-sync.md`, `.agents/rules/domain-operations.md`, `.agents/rules/crash-consistency.md`.

## Hydration e merge guest→account

- `window`: startup/foreground con root + finestra mensile; preservare i mesi locali non caricati.
- `all`: scansione completa per guest→account/operazioni complete; l'assenza remota diventa autorevole per i mesi coperti, quindi le pending locali vengono poi rigiocate.
- **MUST:** non trattare una hydration `all` come finestra parziale.
- **MUST:** il merge guest/cloud passa da `UserDataSchema.parse()` prima della persistenza.
- Array con ID: unione deduplicata con priorità guest in collisione; record per data: merge per data e ID; scalari: guest se valorizzato.
- **NOTE:** “guest wins” non equivale a “dato più recente”. Leggere implementazione e test prima di alterare questa policy.

## Workout, timer e date

### `localWorkout` vs `activeWorkout`

| Campo | Storage | Scopo |
|---|---|---|
| `localWorkout` | `localStorage` owner-scoped + Zustand | Sessione in corso del dispositivo |
| `activeWorkout` | Firestore | Snapshot cloud del workout attivo |

- **MUST:** un fetch cloud non sovrascrive un `localWorkout` attivo.
- **MUST:** su `visibilitychange === 'hidden'`, salvare i dati device-critical sincronicamente e in modo protetto.
- **MUST:** il timer usa timestamp e ricalcolo del delta; non affidarsi a un `setInterval` puro per il tempo reale in background.
- **MUST:** date giornaliere utente in `YYYY-MM-DD` locale tramite l'helper canonico; non usare `toISOString().slice(0, 10)` per rappresentare una data locale.
- Timestamp evento/audit: UTC/epoch; shard mensile derivato dalla data locale business.

## Dati e Zod

- **MUST:** i dati in ingresso da boundary persistiti vengono prima normalizzati/migrati e poi validati dal gateway Zod applicabile.
- **MUST:** nessun `undefined` nei payload Firestore.
- **MUST:** elementi collezione privi dell'identità business richiesta vengono scartati; non creare “ghost record” assegnando identità fittizie per farli passare.
- **MAY:** campi non-identità corrotti possono essere sanitizzati dai sub-schema solo secondo i fallback esplicitamente modellati.
- **MUST:** una versione futura sconosciuta è fail-closed / `update-required`; non riscrivere dati futuri con la versione corrente.

→ Dettagli: `.agents/rules/data-model-and-zod.md`.

## Sicurezza e configurazione Firebase

### Boundary di configurazione

Esistono tre contratti separati:

1. **Client Firebase:** sette env `VITE_FIREBASE_*` lette staticamente in `src/lib/firebase.ts`; tutte devono essere presenti/non vuote nel runtime corrente.
2. **App Check client:** `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`; i nomi V3 legacy restano solo fallback transitori.
3. **Server trusted:** `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` e, per il cron, `CRON_SECRET`. Nessuna di queste deve avere prefisso `VITE_`.

`.env.example` documenta esclusivamente nomi e placeholder sicuri; i valori reali server devono restare in Vercel/secret storage e non vanno committati.

### App Check

- Provider canonico: `ReCaptchaEnterpriseProvider`.
- Il provider viene bootstrap-pato prima di Firestore; il token è acquisito separatamente e può essere ritentato dopo failure.
- Il support check App Check è manuale (`window.crypto`, `window.fetch`); non dipende da Firebase Analytics.
- **MUST:** un `permission-denied` di sync resta `rejected` finché non è stata discriminata la causa; non etichettare genericamente Rules/Auth/App Check senza evidenza.

### Firestore Rules

- **MUST:** ogni modifica a `firestore.rules` deve passare i test emulator pertinenti e il gate canonico.
- Il test Rules e il deploy Rules sono operazioni diverse. Eseguire un deploy reale solo verso un target verificato e quando rientra nel task operativo autorizzato; non rendere una modifica documentale o un test locale capace di modificare implicitamente un progetto Firebase.
- **MUST:** `service-account.json` resta ignorato e nessuna credenziale privata viene committata.

→ Dettagli: `.agents/rules/firebase-config.md`.

## Account lifecycle e cancellazione account

La cancellazione account è un workflow CRITICAL server-mediated. Il client non elimina direttamente il root `/users/{uid}`.

- Vercel Functions autenticano la richiesta e il backend trusted usa Firebase Admin.
- Il job pulisce dati privati/telemetria e cancella Firebase Auth per ultimo.
- `account_deletions/{uid}` è server-only e agisce da barriera cross-device.
- Dopo completamento viene conservato un tombstone tecnico server-only limitato a 30 giorni; il cron autenticato giornaliero elimina i record scaduti.
- La copia locale non viene eliminata finché il client non ha prova del completamento cloud secondo il protocollo di recovery.
- **MUST:** non reintrodurre cancellazioni client-side che bypassino questo workflow.

→ Dettagli: `.agents/rules/account-lifecycle.md`.

## Telemetria, Analytics e privacy

Distinguere due sistemi:

1. **Telemetria tecnica LogBook:** errori/eventi diagnostici sanitizzati; per utenti autenticati può includere UID tecnico, session ID, contesto limitato, tipo/messaggio errore sanitizzato, contatori/timestamp e stack troncato/sanitizzato. Non traccia avvio/salvataggio workout né funnel di installazione PWA. Viene scritta nelle raccolte private dell'utente e non va descritta come “anonima”.
2. **Vercel Analytics / Speed Insights:** renderizzati solo quando l'opt-in analytics è attivo. Google/Firebase Analytics non viene inizializzato né usato.

- **MUST:** l'opt-in Analytics resta disabilitato per default e revocabile dalle Impostazioni.
- **MUST:** telemetria tecnica propria e analytics di utilizzo restano separati; non aggiungere eventi comportamentali workout/PWA alla telemetria tecnica per aggirare l'opt-in.
- **MUST:** la telemetria Firestore nuova usa `expireAt` per la retention di 30 giorni; errori ancorati a `lastSeen`, eventi/anomalie a `timestamp`. Le policy TTL vivono in `firestore.indexes.json`, ma il loro stato live resta **VERIFY** sul progetto Firebase reale.
- **MUST:** errori/stack sottoposti alla telemetria tecnica passano dai sanitizzatori che rimuovono email, IP, token, API key, path utente e chiavi sensibili riconosciute.
- **MUST:** documentazione privacy, UI e codice devono usare terminologia coerente: non promettere anonimato se esiste un identificativo tecnico/pseudonimo.
- **MUST:** nessun documento pubblico/normativo deve incorporare email, indirizzi o altre informazioni private del maintainer. Usare soltanto canali di contatto pubblicamente predisposti dall'app quando esistono.
- **MUST:** una modifica materiale alla Privacy Policy richiede bump di `LEGAL_VERSIONS.privacy` e regressioni pertinenti, così gli utenti devono riaccettare la versione aggiornata.

## PWA, Service Worker e icone

- `vite-plugin-pwa` usa manifest e service worker alla radice `/`.
- La sorgente visuale approvata dell'icona [LB] è canonica; `scripts/resize_icons.mjs` produce favicon, Apple touch, PNG PWA e la card social Open Graph. Quando cambia l'artwork, i riferimenti HTML/manifest devono cambiare revisione per invalidare le cache degli icon consumer.
- Il manifest deve contenere un solo asset standard 512×512 e il dedicato `icon-maskable-512.png` per `purpose: maskable`; evitare duplicati semantici.
- **MUST:** una modifica all'icon pipeline va verificata attraverso build/gate, non solo guardando il file sorgente.
- **MUST:** il reload/update della PWA rispetta il reload barrier di persistenza prima di applicare una nuova versione.

## Design system e UX

Tema adattivo system/light/dark con superfici e controlli ispirati a iOS. `src/styles/global.css` importa i moduli CSS e `src/styles/tokens.css` definisce i token semantici; CSS nativo, sentence case italiano. La scelta del tema è locale al dispositivo, non è un dato di `UserData`.

- **MUST:** usare `GlobalDialog`/`useDialogStore` per dialoghi applicativi; niente `window.alert`/`window.confirm`.
- **MUST:** niente `<dialog>` per form/editor complessi mobile; preferire superfici inline/full-screen/accordion.
- **MUST:** input a `font-size: 16px !important` per prevenire zoom iOS dove applicabile.
- **MUST:** touch target principali almeno 44×44 px.
- **SHOULD:** `min-width: 0` nei figli flex soggetti a overflow; `ContextMenu.tsx` per menu contestuali.
- **MUST:** validare la sintassi CSS e la presenza di tutte le custom properties durante refactor dei token.
- **VERIFY:** comportamento iOS Safari/PWA e viewport stretti per modifiche UX pertinenti.

### React

- **MUST:** sulle superfici mantenute vive sotto `Suspense`, non usare l'attributo HTML `hidden` come meccanismo di tab visibility; il pattern corrente usa `style={{ display: ... }}` e va preservato salvo una migrazione React esplicitamente testata.
- **MUST:** niente fallback inline di array/oggetti nei selettori Zustand che generano una nuova referenza a ogni render; usare costanti stabili.
- **SHOULD:** memoizzazione custom solo dove misurata o già motivata dai componenti ad alta frequenza.

## Processo Git e branch

Per modifiche non banali:

- **MUST:** lavorare su branch dedicato, non direttamente su `main`.
- **MUST:** mantenere la PR draft durante sviluppo/correzioni e renderla pronta solo quando il candidato finale è verificato.
- **MUST:** prima di ogni validazione candidata registrare l'esatto HEAD; dopo un nuovo commit, le verifiche sul vecchio SHA non certificano più il nuovo candidato.
- **MUST:** eseguire review finale del diff ed evitare refactor/formattazioni non pertinenti.
- **MUST:** dopo autorizzazione generale il merge può avvenire autonomamente quando gate e review sono verdi e non restano blocker.

## Test e CI

### Gate canonico

Il gate repository completo è:

```bash
npm run verify:m8
```

`verify:m8` include transitivamente M7 → M6 → M5 e le suite/gate precedenti: lint, typecheck/hardening, unit/integration/isolated/fuzz/recovery/GC/stress, Firebase Rules emulator, Playwright E2E, no-skips, build e controlli M7/M8.

- `npm run lint`, `npm run test`, `npm run build` e `npm run test:e2e` sono diagnostici/sotto-gate; non sostituiscono M8 per il candidato finale.
- `.github/workflows/verification.yml` usa il job stabile **Canonical Verification**, checkout dell'exact event HEAD, Node 24 e `npm audit --audit-level=high` prima di M8.
- **MUST:** non dichiarare verde un gate non realmente eseguito.
- **MUST:** warning inattesi, `act(...)`, unhandled rejection e framework warning nel candidato vanno corretti o spiegati, non soppressi cosmeticamente.
- **MUST:** test normativi devono attraversare il boundary di produzione che dichiarano di verificare; mock e oracle non possono reimplementare il comportamento sotto test.

→ Contratto completo: `.agents/rules/ci-verification.md` e `.agents/rules/verification-hardening.md`.

## Vercel e deployment

`vercel.json` è la configurazione repository canonica. Nel contratto corrente:

- **MUST:** `main` è il solo branch abilitato ai deployment Vercel tramite `git.deploymentEnabled`; i branch di sviluppo sono disabilitati.
- **MUST:** non indebolire questa barriera per ottenere una Preview; la CI GitHub è il gate del branch.
- Il deployment di produzione deve derivare da `main`.
- Dopo il merge verificare: commit effettivo su `main`, Canonical Verification sul commit di `main`, deployment Vercel corrispondente e stato verde di entrambi.
- **VERIFY:** se Vercel Deployment Checks dipende dal nome `Canonical Verification`, non rinominare il job senza prima verificare/aggiornare la configurazione esterna.

## Catalogo globale

`global_catalog` è pubblico in lettura e non scrivibile dal client. I seed bundled correnti sono intenzionalmente vuoti.

- Il seed script rifiuta input vuoti/invalidi prima dell'inizializzazione Admin e supporta dry-run sicuro.
- **MUST:** nessuna pubblicazione parte dai seed bundled vuoti.
- Una write reale richiede file esterni validati/non vuoti, progetto esplicito e conferma esplicita uguale al progetto; non riutilizzare versioni esistenti.
- **MAY:** dry-run/validazione sono incoraggiati e non vanno bloccati dalla policy di sicurezza.

→ Dettagli: `.agents/rules/catalog-operations.md`.

## Repository hygiene ed encoding

- **MUST:** documenti task-specific (`implementation_plan*.md`, report audit/remediation generati, directory legacy di report) non restano nel candidato finale salvo che siano deliberatamente documentazione stabile nel path canonico.
- Istruzioni normative: `AGENTS.md` + `.agents/rules/`; guide stabili: `docs/`; audit storici deliberati: `docs/audits/`.
- **MUST:** Markdown e sorgenti UTF-8 senza BOM; non introdurre mojibake.

## Riferimenti normativi

| Documento | Contenuto |
|---|---|
| [`.agents/rules/storage-and-sync.md`](.agents/rules/storage-and-sync.md) | Storage, versioni, hydration, offline-first e sync |
| [`.agents/rules/domain-operations.md`](.agents/rules/domain-operations.md) | Domain Operations V4 e mutation boundary |
| [`.agents/rules/data-model-and-zod.md`](.agents/rules/data-model-and-zod.md) | `UserData`, Zod, root, shard e local-only |
| [`.agents/rules/account-lifecycle.md`](.agents/rules/account-lifecycle.md) | Backup/import, deletion, logout, guest e PWA update |
| [`.agents/rules/firebase-config.md`](.agents/rules/firebase-config.md) | Env client/server, App Check, Rules, CSP e domini |
| [`.agents/rules/ci-verification.md`](.agents/rules/ci-verification.md) | Gate canonico, exact-head e CI contract |
| [`.agents/rules/crash-consistency.md`](.agents/rules/crash-consistency.md) | Commit atomico, lost ack, replay e recovery |
| [`.agents/rules/causal-gc.md`](.agents/rules/causal-gc.md) | Tombstone/vector-clock GC e stable frontier |
| [`.agents/rules/distributed-fuzz.md`](.agents/rules/distributed-fuzz.md) | Fuzz distribuito e convergenza causale |
| [`.agents/rules/verification-hardening.md`](.agents/rules/verification-hardening.md) | Qualità dei test normativi e production boundaries |
| [`.agents/rules/catalog-operations.md`](.agents/rules/catalog-operations.md) | Catalogo globale, seeding e recovery |
| [`.agents/rules/design-system.md`](.agents/rules/design-system.md) | Tema, CSS, tipografia e UX |
