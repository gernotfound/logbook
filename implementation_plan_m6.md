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

Nessun file sotto `src/` deve cambiare.

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

Il gate non modifica né normalizza automaticamente i file.

## CI contract

Il controllo statico deve garantire almeno:

- trigger PR per `main` e `feat/ui-workout-guest-flow`;
- assenza di `pull_request_target`;
- `permissions: contents: read`;
- checkout esplicito dell'HEAD PR;
- guardia `git rev-parse HEAD` contro lo SHA atteso;
- esecuzione di `npm run verify:m6`;
- `concurrency` con `cancel-in-progress: true`;
- assenza dei due workflow legacy divergenti.

## Acceptance criteria

Prima di proporre M6 per merge:

1. la Draft PR deve attivare automaticamente il workflow canonico;
2. il log deve dimostrare checkout dell'HEAD PR esatto;
3. `npm run verify:m6` deve terminare con exit code 0 in GitHub Actions;
4. Antigravity deve ripetere `npm run verify:m6` da una working tree pulita sullo stesso HEAD;
5. `test:repo-hygiene` e `test:ci-contract` devono passare separatamente;
6. nessun file `src/` deve essere modificato;
7. la regressione M0–M5 deve restare verde.

## Rischi

Il gate UTF-8 può scoprire debito encoding tracciato. Eventuali file problematici vengono corretti puntualmente, senza conversioni massive.

La pipeline completa è più lenta dei workflow legacy parziali; non si riduce la copertura per accelerarla.

`npm audit` dipende dallo stato corrente del registry e viene distinto da un fallimento di `verify:m6`.

## Rollback

Il rollback consiste nel rimuovere workflow/script M6, ripristinare i due workflow legacy e rimuovere gli script M6 da `package.json`. Non servono migrazioni o rollback production.
