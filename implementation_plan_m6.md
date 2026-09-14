# M6 — CI Reproducibility & Exact-Head Verification

Baseline canonica: `f50e9ceb4588050e10a26341a5b1d94d9eec076c`

Branch: `chatgpt/m6-ci-reproducibility`

## Obiettivo

Rendere il gate M0–M5 riproducibile e automaticamente eseguibile da GitHub Actions sulle PR reali del progetto, verificando esplicitamente l'HEAD della PR e una working tree pulita.

M6 non modifica comportamento applicativo, schema dati, protocollo sync, regole Firestore o dipendenze runtime.

## Modifiche previste

- aggiungere `.github/workflows/verification.yml` come unico workflow canonico di verifica;
- rimuovere i workflow legacy `.github/workflows/test.yml` e `.github/workflows/playwright.yml`, che duplicano solo sottoinsiemi del gate e scattano soltanto verso `main`;
- aggiungere `scripts/check-repo-hygiene.mjs` per working-tree cleanliness e UTF-8/BOM sui file testuali tracciati;
- aggiungere `scripts/check-ci-contract.mjs` per validare staticamente trigger, permissions, exact-head checkout e uso di `verify:m6`;
- aggiungere `test:repo-hygiene`, `test:ci-contract` e `verify:m6` a `package.json`;
- aggiungere `.agents/rules/ci-verification.md` con gli invarianti normativi M6.

Nessun comportamento sotto `src/` deve cambiare. Sono consentite esclusivamente bonifiche encoding puntuali rese necessarie dal nuovo hygiene gate, senza variazioni di token o semantica sorgente.

## Gate canonico

`verify:m5` resta immutato.

`verify:m6` esegue:

1. `test:repo-hygiene`
2. `test:ci-contract`
3. `verify:m5`

In questo modo tutta la regressione M0–M5 resta transitivamente obbligatoria.

## Exact-head checkout

Per `pull_request`, GitHub Actions deve fare checkout esplicito di `github.event.pull_request.head.sha` e confrontare `git rev-parse HEAD` con lo SHA atteso prima di eseguire qualunque test.

Per `push` e `workflow_dispatch`, lo SHA atteso è `github.sha`.

## CI runtime

Il workflow usa:

- `actions/checkout@v7`;
- `actions/setup-node@v7`, Node 24, cache npm;
- `actions/setup-java@v6`, Temurin 21, per Firebase Emulator;
- `npm ci`;
- `npx playwright install --with-deps chromium`;
- `npm audit --audit-level=high` come check registry-dependent separato;
- `npm run verify:m6` come acceptance gate deterministico del repository.

Le run obsolete della stessa PR/ref vengono cancellate tramite `concurrency`.

## Repo hygiene

Il gate deve fallire su modifiche o file non tracciati non ignorati prima della verifica. I file testuali tracciati vengono decodificati con UTF-8 fatal decoding e non possono contenere BOM UTF-8.

La selezione dei file unisce i formati testuali noti del repository con i file non-binari rilevati da Git tramite `git grep -I`, evitando che formati testuali tracciati come SVG restino fuori dalla verifica solo perché non presenti in una whitelist iniziale.

Il gate non modifica né normalizza automaticamente i file.

## CI contract

Il controllo statico deve garantire almeno:

- trigger PR per `main` e `feat/ui-workout-guest-flow`;
- assenza di `pull_request_target`;
- assenza di riferimenti a `secrets.*` nel workflow M6;
- `permissions: contents: read`;
- checkout esplicito dell'HEAD PR;
- guardia `git rev-parse HEAD` contro lo SHA atteso;
- esecuzione di `npm run verify:m6` con propagazione del failure tramite `pipefail`;
- `concurrency` con `cancel-in-progress: true`;
- runtime Node 24, Temurin Java 21 e Chromium espliciti;
- assenza dei due workflow legacy divergenti.

Le verifiche sono legate ai blocchi e agli step attivi del workflow, non alla mera presenza globale di stringhe che potrebbero comparire in commenti o testo non eseguito.

## Finding prima run CI

La prima run GitHub Actions (`34841537860`) ha superato checkout exact-head, setup runtime e `npm audit`, poi `test:repo-hygiene` ha rilevato quattro BOM UTF-8 già tracciati:

- `src/components/analytics/index.ts`;
- `src/store/slices/createSyncSlice.ts`;
- `src/views/HomeView.tsx`;
- `tests/use_wake_lock.test.ts`.

I quattro file sono stati bonificati rimuovendo esclusivamente il BOM iniziale. Il diff del commit di remediation mostra una sola riga rimossa e una aggiunta per file, senza modifica del contenuto testuale.

## Finding Linux case sensitivity

La run diagnostica `34843347725`, sull'HEAD `4d1dc7f2d15f0b9c760ae7dfffdc12a891cc1f09`, ha raggiunto la suite stress e ha esposto un import preesistente con casing errato in `tests/challenger_react_hooks_memo_stress.test.tsx`: il repository usa `src/components/Training`, mentre il test importava `src/components/training`.

La remediation modifica esclusivamente i tre import del test verso `Training/...`, senza variazioni a `src/`. Il commit `b0f91b8ac82417a91d617c7e8ff1b91f5c9d942c` contiene soltanto queste tre differenze di casing.

La successiva run `34849756154` sullo stesso commit ha completato con successo exact-head guard, setup, audit e l'intero `npm run verify:m6`.

## Finding review statica finale

Dopo la prima run completamente verde, la review statica indipendente del delta M6 ha individuato due possibilità di false-green nei nuovi gate:

1. `check-ci-contract.mjs` usava inizialmente semplici `includes()`, quindi una stringa obbligatoria spostata in un commento YAML avrebbe potuto soddisfare il controllo. Il gate è stato irrigidito con pattern ancorati agli step/blocchi attivi e ai relativi comandi/azioni.
2. `check-repo-hygiene.mjs` selezionava i file testuali con una whitelist di estensioni che escludeva almeno gli SVG tracciati. Il gate ora unisce i formati noti ai file testuali rilevati da Git.

Questi hardening cambiano l'HEAD dopo la run verde `34849756154`; pertanto quella run non è sufficiente come evidenza finale M6. È obbligatoria una nuova run completa sul nuovo HEAD finale prima dell'handoff ad Antigravity.

## Acceptance criteria

Prima di proporre M6 per merge:

1. la Draft PR deve attivare automaticamente il workflow canonico;
2. il log deve dimostrare checkout dell'HEAD PR esatto;
3. `npm run verify:m6` deve terminare con exit code 0 in GitHub Actions;
4. Antigravity deve ripetere `npm run verify:m6` da una working tree pulita sullo stesso HEAD;
5. `test:repo-hygiene` e `test:ci-contract` devono passare separatamente;
6. nessuna modifica semantica a `src/`; eventuali differenze sono limitate a bonifica encoding puntuale documentata;
7. la regressione M0–M5 deve restare verde.

## Rischi

Il gate UTF-8 può scoprire debito encoding tracciato. Eventuali file problematici vengono corretti puntualmente, senza conversioni massive.

La pipeline completa è più lenta dei workflow legacy parziali; non si riduce la copertura per accelerarla.

`npm audit` dipende dallo stato corrente del registry e viene distinto da un fallimento di `verify:m6`.

## Rollback

Il rollback consiste nel rimuovere workflow/script M6, ripristinare i due workflow legacy e rimuovere gli script M6 da `package.json`. Non servono migrazioni o rollback production.
