# CF-00 — banco di prova isolato Workers / D1 / hashing

Questo codice è un **prototipo di fattibilità**, non il backend di TheLogBook. Usa un proprietario sintetico fisso, ciphertext fittizio e tabelle `cf00_*`. Non legge né modifica account, dati o segreti reali. **Non è autorizzato a sostituire Firebase e non è un gate di rilascio Production.**

## Contratti provati

- `contract.mjs`: `D1Database.batch()` deve eseguire atomicamente una guardia che rifiuta revisione/consenso stantii. Un `UPDATE` su 0 righe non basta: il trigger SQLite solleva un errore che fa rollback dell'intero batch. La ricevuta conserva anche il `writer` sintetico oltre a revisione e consenso, così il chiamante può identificare una collisione di `batchId` confrontando i campi della ricevuta con la propria richiesta. **Limite:** in produzione l'identità della richiesta deve includere l'intero payload autenticato (o la sua impronta), non solo il percorso sintetico.
- `probe-worker.mjs`: default deny (404), accesso soltanto con `CF00_PROBE_ENABLED=true` e secret lungo almeno 32 caratteri. La classe Durable Object esegue esclusivamente hashing di un input sintetico, usando parametri **documentati OWASP**: scrypt `N=2^14,r=8,p=5`, PBKDF2-HMAC-SHA256 `600000`. Il risultato espone soltanto durata **wall-clock**, parametri e lunghezza dell'output, **non il tempo CPU del provider** né l'hash.
- La route protetta `/__cf00/write` riporta `queryMetrics` soltanto se `D1Database.batch()` fornisce metadati di righe lette/scritte e dimensione DB; se il runtime non li fornisce, restituisce `null` (mai contatori inventati). `/__cf00/plan` verifica il piano di tre query prefissate con `EXPLAIN QUERY PLAN`, senza SQL passato dall'esterno. Le misure di workerd locale NON sono quelle del provider remoto, e non misurano CPU di Workers.
- `tests/cloudflare/cf00-feasibility.node.mjs`: adapter minimale Node SQLite, test di conflitto serializzato, rollback, consenso, identità della ricevuta, default-deny e hashing senza output segreto. L'adapter Node usa operazioni SQLite sincrone: `Promise.allSettled` non rende le due scritture realmente contemporanee. L'adapter **non simula** la rete D1, il comportamento del servizio Cloudflare, CAS multi-PoP o il budget CPU di Workers Free.

## Esecuzione locale, senza Cloudflare

Usare **Node 24.x** (versione canonica del repository) e:

```sh
npm run test:cf00
npx wrangler@4.159.0 dev -c cloudflare/cf00/wrangler.local.jsonc --local
```

Per abilitare le route del Worker durante un test HTTP locale, creare un file non versionato `cloudflare/cf00/.dev.vars` contenente `CF00_PROBE_ENABLED=true` e `CF00_PROBE_SECRET=<segreto casuale di almeno 32 caratteri>`. Generarlo localmente, non inserirlo in Git, chat, issue o log. Lo script è inutilizzabile senza entrambe le condizioni.

Dopo l'avvio si possono inviare richieste POST, con header `x-cf00-secret`, agli endpoint `/__cf00/init`, `/__cf00/write`, `/__cf00/state`, `/__cf00/receipt`, `/__cf00/plan` e `/__cf00/password?algorithm=scrypt|pbkdf2`. `/__cf00/init` azzera **solo** le righe del proprietario sintetico nelle tabelle `cf00_*`.

## Prova remota temporanea (Durable Object, senza credenziali)

Il workflow PR-only `.github/workflows/cf00-temporary-remote.yml` esegue `tests/cloudflare/cf00-temporary-remote.mjs` **solo** su branch CF-00 dello stesso repository. Usa `wrangler deploy --temporary` su un account Cloudflare effimero separato, senza il token, il dominio o i dati del proprietario. Un secret casuale è iniettato da file temporaneo con permessi stretti; il claim URL (credenziale bearer) resta catturato in memoria, mai stampato. Sono consentite solo poche richieste al Worker; la route D1 non è disponibile in questa configurazione. Non riscattare l'account temporaneo: Cloudflare ne rimuove automaticamente le risorse alla scadenza.

**Limiti probatori:** questa verifica utilizza infrastruttura Cloudflare reale, ma non l'account Workers Free definitivo. Cloudflare congela `performance.now()` durante la CPU: il delta interno può essere `0` anche quando scrypt ha calcolato correttamente. Il test misura quindi la latenza round-trip dall'esterno, **non** CPU billing. La prova remota del 12/11/2026 [run #43308065129](https://github.com/gernotfound/logbook/actions/runs/43308065129) ha inoltre restituito `NotSupportedError` per PBKDF2 600.000 iterazioni, perché il runtime rifiuta valori superiori a 100.000; tale incompatibilità è esplicita e **non** autorizza ad abbassare il work factor. scrypt deve completarsi con i parametri OWASP invariati. Non prova Better Auth, i flussi email, D1 EU, quote e residenza. Un fallimento per rifiuto anti-abuso del provider, indisponibilità dei temporary accounts o mancanza di supporto è un **blocco del test remoto**, non un bug dimostrato della PWA. Fonte: https://developers.cloudflare.com/workers/platform/claim-deployments/

## Cosa manca prima di dichiarare CF-00 validata

1. Eseguire il prototipo sotto `wrangler dev --local` (workerd/Miniflare) e controllare che trigger e Durable Object corrispondano al contratto.
2. Misurare hashing su **Workers Free remoto realmente isolato**, verificando CPU e quota con metriche provider, carico basso e limite predeterminato; la sola durata `wallMs` non prova consumo CPU.
3. Creare, se strettamente necessario e con token Cloudflare a scopo minimo, un D1 di prova **separato** con `--jurisdiction=eu`; non usare database Production. Testare concorrenza remota, abort/rollback, lost ACK, quote e cleanup. La configurazione `wrangler.local.jsonc` contiene un UUID fittizio e **non** si può deployare come D1 remoto.
4. Verificare Better Auth attuale (bundle `workerd`, KDF, sessioni, OAuth) e invio di email transazionali gratuito con ricezione effettiva. Se falliscono, CF-00 rimane NO-GO; non indebolire la KDF o attivare billing automaticamente.

Fonti: [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 sviluppo locale](https://developers.cloudflare.com/d1/best-practices/local-development/), [limiti Workers](https://developers.cloudflare.com/workers/platform/limits/), [limiti Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits/), [OWASP password](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Tracking: [epic #1053](https://github.com/gernotfound/logbook/issues/1053) e [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054).
