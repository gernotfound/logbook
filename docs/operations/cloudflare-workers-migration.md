# TheLogBook — migrazione Cloudflare: runbook corrente

**Classificazione: CRITICAL · stato PARZIALE / NO-GO funzionale (dominio pubblico di sviluppo autorizzato).** La fonte di verità per il codice e i test è `main` GitHub; per risorse e runtime sono i rispettivi provider. Questo documento descrive **contratti correnti e blocchi**, non lo storico di commit. [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053) · [registro servizi](external-services-register.md) · [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063).

## Decisioni confermate

- **Fresh start:** non esistono account/dati pre-lancio da trasferire; niente migrazioni Firebase→D1 di utenti, password, chiavi, consensi, sessioni o dati sanitari. Preservare invece tutte le funzioni approvate, il motore locale e i formati che il sistema nuovo effettivamente creerà.
- **Frontend:** Cloudflare Workers Static Assets; **backend:** API Workers e D1 SQL con giurisdizione `eu` da verificare sull'istanza effettiva. Nessun billing o upgrade autorizzato.
- **Identità:** Kinde scelto per Email e Google; questi pulsanti sono stati abilitati nell'onboarding. **Metodo email/password ≥15 caratteri, Google OAuth, reset/verifica e sessioni non sono ancora collaudati**. I messaggi Auth saranno gestiti da Kinde, senza un servizio email separato.
- **Confini di fiducia:** Kinde conferma l'identità; Workers/D1 devono autorizzare owner, stato account, consenso salute, revoca, cancellazione, sessioni e quote. Nessun dato salute in chiaro su Kinde o D1. Una sessione valida e un JWT firmato non sostituiscono consenso e owner fence.
- **Dominio di sviluppo (decisione 14/11/2026):** `https://thelogbook.me` è l'unico origin pubblico richiesto per il frontend. Il proprietario autorizza il cambio DNS/Workers per il sito e la disabilitazione dei collegamenti `workers.dev` e preview del solo Worker TheLogBook. Il deployment resta vincolato a `main` verificato, con esito runtime da osservare. Il dominio pubblico **non** certifica una release funzionale: Auth, consenso cloud, replica, chiavi e diritti rimangono non attivi finché non sono verificati.
- **Dismissione:** eliminare funzioni Firebase/Vercel solo dopo aver verificato il percorso equivalente. Non mantenere compatibilità con installazioni pre-lancio inesistenti. OAuth/posta Production, credenziali, billing e dismissioni irreversibili richiedono mandato e GO separati.

## Stato osservato e limiti delle prove

| Componente | Stato osservato | Prova ancora mancante |
|---|---|---|
| GitHub | Candidati Cloudflare e verificatori Kinde integrati; CI e CodeQL su SHA specifici | La CI non dimostra API Cloudflare o login live |
| Static Assets | Provider verificato 14/11: Worker `thelogbook-frontend` associato al Custom Domain `thelogbook.me` con certificato TLS assegnato; `workers.dev` e preview disabilitati, solo binding `ASSETS`. Checkpoint verificati del frontend statico: `main 2077ece8fe9f1deacc3222958b98b3a26b30ac60` (v2.409.0), [workflow #43609342261](https://github.com/gernotfound/logbook/actions/runs/43609342261) tentativo 3 **SUCCESS** dopo la disattivazione dell'iniezione Web Analytics; successivamente `main dd40b6652788bde12b8a8e32b25857ef6db7dcf9` (v2.410.0), [workflow #43611888502](https://github.com/gernotfound/logbook/actions/runs/43611888502) tentativo 1 **SUCCESS** (asset, headers, 404, JS/CSS, shortcut PWA). Per lo SHA più recente consultare [issue #1041](https://github.com/gernotfound/logbook/issues/1041) e GitHub Actions; un nuovo merge invalida il confronto con questi SHA storici. | Smoke completo sullo SHA distribuito, comportamento guest/PWA, cache/update e Safari iOS; Auth cloud separata |
| D1 | Sandbox `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu`; migrazioni `0001`–`0008` applicate e registro Wrangler confermato sul provider il 14/11, dati sintetici invariati | API HTTP, query/CPU/quote reali, restore e database Production non attestati |
| Workers API/Auth | `cloudflare/api/worker.mjs`, session gate, issuer, consenso e replica nel repository; **nessuna API Worker pubblicata** nel controllo provider disponibile | Binding isolati, callback OAuth trusted, session issuance end-to-end, prove browser e runtime |
| Kinde | Business `thelogbook.kinde.com` in regione `Europe - Ireland` secondo schermate; selezionati metodi Email e Google nell'onboarding | Applicazione OAuth, codice autorizzazione + PKCE/state/nonce monouso, password, email, claim reali, retention e antiabuso |
| DNS e provider legacy | Il DNS web dell'apice serve il Worker tramite record Cloudflare originless proxied; record MX/DKIM/DMARC IONOS invariati nel controllo provider del 14/11. Hosting Firebase disabilitato secondo proprietario, Vercel `logbook` sospeso secondo precedente verifica. | HTTPS smoke della release esatta, browser guest/PWA; API e codice legacy da sostituire e verificare separatamente |

Il `jurisdiction=eu` della D1 **non garantisce** localizzazione europea di Workers, log, email, Google OAuth o tutti i subprocessori. Non dedurre conformità GDPR da un singolo flag.

**Pubblicazione frontend:** la lettura del `robots.txt` pubblico ha confermato che Bot Preference Sync inserisce una policy Content Signals prima del file applicativo; le delimitazioni effettive sono `# BEGIN Cloudflare Managed content` e `# END Cloudflare Managed Content`. Il precedente smoke della v2.407 falliva anche su output valido perché confrontava una prima riga errata. `scripts/verify-cloudflare-served-asset.mjs` mantiene il confronto byte-per-byte per tutti gli asset e ammette **solo per `/robots.txt`** un wrapper riconosciuto (max 8 KiB), con `ai-train=no` e l'intero file originario come suffisso esatto. Lo smoke prevede al massimo quattro confronti sulla stessa URL, con tre pause limitate per convergenza edge; un mismatch persistente continua a fallire con diagnostica. La stessa garanzia è estesa alla scorciatoia di navigazione `/?tab=training`: risposta HTML identica ai byte di `index.html`, tentativi limitati e diagnostica di risposta (status, cache, hash) se non converge; non basta un HTTP 200 né un corpo HTML genericamente valido. Test negativi coprono policy falsificata, suffisso alterato, route diverse ed errori del validatore. Non disabilitare la protezione bot per rendere verde la CI. Queste prove non attestano funzionamento Auth/Sync o Safari.

### Audit del rilascio frontend del 14/11/2026

- **Rilievo privacy/runtime verificato:** il provider aveva Web Analytics/RUM `on`, un sito Analytics `auto_install=true` e ruleset `enabled=true`, nonostante il divieto di telemetria client automatica. In HTTP `/?tab=training` rispondeva 200 ma con 4004 byte e SHA-256 `edeb98426beab2b88843a3f32a9bf3342c8e5a0b2e136e74396faa3305ce90e6`, contro i 3637 byte e SHA-256 `42480e612f45d5b4a16ae8dcb661fed3edd9ae7d9cfd53689eb222d58889b29c` della build. Le richieste con `Cache-Control: no-cache` restituivano il contenuto corretto, ma un purge mirato di `/?tab=training` non eliminava il mismatch. Non attribuire senza prove a un deposito statico obsoleto.
- **Correzione provider (non distruttiva):** disattivato RUM e successivamente `auto_install`; l'API rappresenta ora la zona come `rum=manual`, con `auto_install=false` e ruleset `enabled=false`, senza snippet nella build applicativa. Non sono stati eliminati il sito Analytics, dati storici, DNS, email o segreti. Ulteriore richiesta `rum=off` da modalità manual è stata rifiutata dal provider (errore 10028); il criterio operativo è **nessuna raccolta automatica e nessuna iniezione**, non imporre un valore API non applicabile.
- **Conferma indipendente:** stesso commit `2077ece8fe9f1deacc3222958b98b3a26b30ac60`, stessa build, [run #43609342261](https://github.com/gernotfound/logbook/actions/runs/43609342261) tentativo 3 **SUCCESS** dopo il cambio impostazioni, inclusa la navigazione `/?tab=training`. La CI precedente già verde non dimostrava la correttezza dei byte all'edge. Sono rimasti attivi Bot Preference Sync, i controlli CSP, il confronto SHA/byte-exact, i 404 e la restrizione a `thelogbook.me`; `workers.dev` e preview restano disabilitati.
- **Limiti:** è verificato soltanto il frontend statico pubblico, **non** Auth/email/Google, consenso cloud, D1, sync, cancellazione, browser Safari iOS, risorse reali o conformità GDPR. Confermare lo stato Analytics presso Cloudflare dopo ogni cambiamento del provider; il controllo HTTP è il gate di regressione automatico. Dati eventualmente già raccolti dal sito Analytics non sono stati inventariati né eliminati.

### Incremento CF-04 — stato di un commit D1 non confermato

Il codice candidato espone `commit/status` sotto AuthGate e CSRF di sessione. Una SELECT SQL sulla D1 primaria controlla **insieme** la revisione corrente e la presenza di una receipt hash-bound del batch. Senza ricevuta e senza avanzamento della revisione l'esito è `inconclusive`, non autorizza nuova write; dopo avanzamento senza ricevuta è `not-committed`, che può servire a un futuro rebase. La risposta `committed` non sostituisce il controllo `receipt()` né autorizza un ACK. Test isolati verificano conflitti, receipt storica, CSRF/sessione revocata, hash alterato e limite HTTP. Il client candidato aggiunge ora `restageUncommittedCloudflareDelivery()` dopo un `409`: usa `commitOutcome`, scansione completa autenticata con ADK e due letture del registro coerenti, quindi ricalcola il merge causale e sostituisce l'intento in un solo update IndexedDB. Il nuovo intento resta `retry-staged`: il batch non viene inviato né ACKato nella stessa chiamata. In assenza di prove, o con stessa replica già avanzata, conserva i ciphertext originali e il journal. **Non è ancora integrato nel runtime PWA, né pubblicata alcuna API Worker.**

### Incremento CF-04 — composizione del journal D1 isolata (14/11/2026)

`src/lib/sync/cloudflareJournalCandidate.ts` compone il controllo replica e la lettura dei documenti con lo staging cifrato `stageCloudflareDelivery()` e il recupero della ricevuta `resumeCloudflareDelivery()`. Legge prima un eventuale intento già durevole, riutilizzandolo immutato; non sostituisce il writer Firestore nel frontend. I test isolati coprono ACK verificato, perdita della risposta, revisione mutata, cambio sessione, guest e CSRF assente. **Restano non implementati** recovery dopo commit 409 definitivamente non committato, bootstrap/hydration e integrazione con Kinde/ADK reali: il candidato non va distribuito come sync funzionante. CI e merge hanno prove separate dal runtime Workers/D1.

### Incremento CF-05 — chiavi ADK/KEK su Workers/D1 (candidato isolato)

`cloudflare/api/cloud-key-crypto.mjs` è il codec WebCrypto AES-256-GCM di una ADK random per UID con AAD owner-bound, IV casuale, formato v1 stretto. `cloud-key-store.mjs` legge e rilascia la chiave wrappata solo attraverso claims fidati del private AuthGate e una nuova verifica SQL primaria di sessione, consenso, epoch e scopo. La creazione condizionale richiede consenso appena accettato, nessun documento/replica/ricevuta o job attivo e registro issuance assente per quella generazione; il trigger della migration `0007_cloud_key_custody.sql` crea la prova `cloud_key_issuance` **nella stessa transazione**. Anche senza la riga wrapped, un marker issuance persistente impedisce rigenerazione sopra dati orfani. I concorrenti leggono il winner salvato, senza credere a un ACK perso. Dopo revoca `rights-export` legge soltanto una ADK già presente, senza provisioning. Update della chiave vietato; DELETE richiede un job di erasure lease-fenced in fase `awaiting-keys`.

**Non attivato:** nessuna route API delle chiavi, secret Cloudflare o integrazione browser; la migration 0007 è installata nella D1 isolata ma non rilascia chiavi. La KEK v1 di Cloudflare richiede provisioning autorizzato, custodia esterna indipendente e prova di restore/rotation senza perdere ADK. CF-06 deve ancora cancellare la chiave con prova durevole e terminare il job; CF-08 deve bloccare ripristini anti-resurrection. I test SQLite/fake AuthGate non certificano il runtime D1 Free, Kinde reale o GDPR.

## Integrazioni candidate presenti nel repository

**Provider OAuth/Kinde — configurazione amministrativa osservata, non login operativo (14/11/2026):** nel progetto Google Cloud `thelogbook-oauth` il pannello Audience mostra **Esterno / In produzione**; il proprietario conferma credenziali Google proprie impostate nella social connection Kinde `TheLogBook`, con **Email Password e Google attivi, Email Code/Phone/Username disattivati** come da screenshot. La schermata Kinde Details mostrava inizialmente tutti gli URI vuoti; il proprietario ha poi confermato **Application homepage URI = `https://thelogbook.me/` salvato**, senza read-back indipendente. **Application login URI, Allowed callback URLs, Allowed logout redirect URLs** non risultano configurati. L'indirizzo homepage Google OAuth è invece `https://thelogbook.me/about`; la callback `https://thelogbook.kinde.com/login/callback` appartiene a **Google→Kinde**, non a **Kinde→Workers**. Le pagine statiche `/about` e `/privacy` sono state verificate con smoke Cloudflare [#43616173486](https://github.com/gernotfound/logbook/actions/runs/43616173486). Implementazione callback OAuth Code+PKCE con state/nonce monouso, sessione trusted, browser/Safari, password ≥15 anche reset ed email reale restano **NO-GO**. [Guida dettagliata Kinde](kinde-auth-setup.md), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

**Google Branding / Search Console — provider verificati da screenshot del proprietario (14/11/2026):** Search Console ha mostrato **«Proprietà verificata»** per la nuova proprietà Dominio `thelogbook.me`, dopo che l'integrazione con Cloudflare ha autorizzato l'inserimento di un TXT DNS. Il TXT non va rimosso. La prima richiesta di verifica Branding aveva segnalato la homepage `https://thelogbook.me/about` non registrata al proprietario; dopo la verifica dominio, il pannello Google OAuth `thelogbook-oauth` mostra **«Il tuo branding è stato verificato e viene mostrato agli utenti»**. Logo PWA, homepage `/about` e informativa `/privacy` sono visibili nel pannello. Questo chiude il gate amministrativo **proprietà dominio/Branding Google**, non il test OAuth, il controllo di scope e redirect client, i Termini pubblici o la revisione legale della Privacy. Non certifica login Kinde, API Worker, sessioni D1, sicurezza Auth o GO della release.

**Auth (CF-03):** `cloudflare/auth/kinde-token-verifier.mjs` verifica firma JWKS RS256, issuer, audience API, client/azp, scadenza e subject. `kinde-login-proof.mjs` verifica in più ID token, audience distinta, `email_verified`, nonce, corrispondenza del soggetto e `at_hash` se presente. `kinde-principal-provisioner.mjs` è un candidato **interno, non un endpoint**: dopo quella verifica deriva un UID D1 stabile da SHA-256 con separazione di dominio su `(issuer, subject)` e inserisce una sola volta un principal verificato; una lettura primary-sequential conferma l'esito, senza riattivare principal disabled/deleted né azzerare epoch. Non importa dati Firebase e non salva email o salute. Il callback reale deve ancora creare e consumare un `state` monouso server-side, verificare il code exchange PKCE e fornire il nonce originale prima di chiamare il provisioner e, solo dopo prova autorevole, `session-issuer.mjs`. In caso di risposta D1 ambigua non si emette una sessione. Resta da verificare revoca Kinde e modifica successiva dello stato email. `session-gate.mjs` controlla sessione e autorizzazioni per gli accessi successivi. Mai accettare UID o nonce direttamente dal client come prova sufficiente. [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

**Replica (CF-01/02/04):** `cloudflare/api/worker.mjs`, `d1-document-store.mjs` e `replica-maintenance.mjs` definiscono il trasporto D1 con SQL CAS, session/consent fence e receipt. `cloudReplicaDurableDelivery.ts` e i moduli contigui persistono il batch ciphertext e il prefisso journal in IndexedDB **prima** della rete; una ricevuta originale verificata autorizza solo l'ACK di quel prefisso, mai un successo su timeout o stato ambiguo. È vietato esporre un'API con AuthGate sintetico o collegare D1 a `replicateJournal()` prima del percorso identità/consenso reale. [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058).

**Consenso, cifratura e cancellazione (CF-05/06):** migrazioni `0003`–`0006`, gate del consenso e worker di cancellazione health sono candidati locali nel repository. Il runner bounded usa lease/epoch, avanzamento per tabelle e rifiuto di completamento fittizio: uno stato `awaiting-keys` **non è** `complete`. Restano da collegare chiavi cloud, diritti, export, erasure completa e receipt, recovery, account Kinde e cron sul Worker reale. La DEK device e la chiave cloud account rimangono indipendenti. Non promettere E2EE/zero-knowledge né recupero impossibile. [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059) · [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060).

**Sicurezza perimetrale (CF-07):** il candidato `cloudflare/api/worker.mjs` applica budget JSON **per route**, prima del parsing: `control` 128 B, `read` 512 B, `scan` e `receipt` 256 B, membership `claim/retire/status` 4 KiB; il commit mantiene il budget di otto documenti cifrati (~7,6 MB). Lo stream viene limitato anche senza `Content-Length`; URL di sync con query non sono alias validi. Questi limiti sono verificati su fixture HTTP/SQLite e **non dimostrano ancora** CPU/abuso su Workers Free. Turnstile, quando usato, deve avere Siteverify server-side con hostname/action e token monouso; Cloudflare WAF non protegge automaticamente gli endpoint hosted Kinde. Limitare richieste, CPU, query e abuso di email/login; verificare anche accessi diretti tramite `workers.dev`, version/preview e custom domain. Un limite Free o un errore del provider devono fallire in sicurezza senza perdere journal o concedere ACK fittizi. [CF-07 #1061](https://github.com/gernotfound/logbook/issues/1061).

## Sequenza di completamento

1. Su tenant Kinde isolato: verificare policy password ≥15 su registrazione e reset, login Google, email verificata, MFA, logout/revoca, erasure via API nel Free, privacy/retention e redirect Safari/iOS. Non trascrivere token, chiavi o dati personali nel repo.
2. Implementare callback OAuth code + PKCE/state/nonce server-owned monouso, mappatura account D1 e sessione applicativa con cookie Secure/HttpOnly/SameSite + CSRF; prova multi-tab/multi-device e revoca effettiva.
3. Collegare ADK/device vault e consenso prima della replica; provare D1 su dati sintetici, ACK, offline, conflitti, crash, lost-response e owner isolation, sempre senza salute plaintext lato server.
4. Completare export/delete, revoca salute, cancellazione account (identità Kinde compresa), inattività 12 mesi, backup/restore e job bounded; errori e retry devono lasciare ricevute verificabili.
5. Misurare quote Free, CPU/storage, denial-of-service, privacy e sicurezza; verificare UX per viewport/theme/accessibilità, update PWA e rollback su Safari. Il dominio è autorizzato **solo per lo sviluppo pubblico**; il GO funzionale completo resta vincolato ai gate GitHub, provider e prodotto. Non usare il cutover del dominio come prova di funzionalità o di continuità dati.

Le parti indipendenti possono avanzare in parallelo a CF-00, ma **nessuna dipendenza non validata può essere attivata nel percorso reale**. Non eseguire deploy non-main su risorse Production o test su dati Production.

### CF-07 — preflight economico delle API candidate (14/11/2026)

Il Worker API controlla Content-Type JSON e Content-Length dichiarato prima di chiamare il service binding privato AuthGate. Le richieste chiaramente invalide ricevono 415/413 senza consumare il rate limiter né la verifica di sessione/consenso; il corpo streaming resta limitato e letto soltanto dopo Auth, per non fare parsing costoso di payload non fidati. Un test Node/SQLite attraversa il vero handler del Worker e verifica che AuthGate non venga chiamato nei casi respinti. Il controllo degli header **non** sostituisce WAF, Turnstile, quota CPU/D1, dimensione streaming né hard cap globali. Nessun Worker API è pubblicato.

## Contratti e tracciamento

[AGENTS](../../AGENTS.md) · [Account](../../.agents/rules/account-lifecycle.md) · [Archivio cifrato](../../.agents/rules/secure-storage.md) · [Storage/sync](../../.agents/rules/storage-and-sync.md) · [Consenso](../../.agents/rules/health-consent.md) · [CI](../../.agents/rules/ci-verification.md) · [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054) · [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063) · [hosting/DNS #1041](https://github.com/gernotfound/logbook/issues/1041). Lo storico degli incrementi è consultabile nella cronologia Git e nelle PR, non copiato come checklist nel runbook corrente.


### CF-05 — precisione dell'orologio SQL per sessioni e lease (14/11/2026)

Il codice delle transazioni D1 candidate confrontava timestamp del Worker
`Date.now()` con
`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`.
La sottrazione su floating point seguita da troncamento poteva produrre
un millisecondo in meno del timestamp intero, causando rifiuti
intermittenti della sessione appena emessa. Il candidato utilizza
un'espressione condivisa basata su
`strftime('%s','now')` più i millisecondi frazionari, senza
conversione Julian floating point, nei gate di custodia ADK, fence
sessione e worker erasure. Il test SQL verifica valori fissi, limite
di secondo e sessioni appena emesse, oltre alle regressioni CF-05.

**Distinzione schema/provider:** la vecchia espressione è ancora presente
nelle migration storiche `0001_encrypted_replica.sql` e
`0007_cloud_key_custody.sql` (trigger D1): non riscrivere
migration già applicate; gli eventuali trigger da correggere richiedono
una nuova migration verificata su database sintetico/restore e un
separato gate Provider. Nessuna modifica al D1 remoto è compresa
in questo fix; la CI SQLite non certifica il runtime Cloudflare.

### CF-03 — composizione HTTP Auth (solo codice candidato, 14/11/2026)

Dopo l'integrazione della PR #1111 (Kinde Code+PKCE), il modulo candidato
`cloudflare/auth/kinde-http-worker.mjs` prepara l'accesso
HTTP HTTPS same-origin, introspezione della sessione D1 tramite
`AUTH_GATE` e logout della singola sessione CSRF-bound.
Nuovi test Node/SQLite/Jose e config Wrangler locale, senza collegamento
al frontend o pubblicazione API. Kinde Audience, callback, Free,
password/Google/email reali, rollout UI, provider DNS, consenso/recovery
e browser Safari restano NO-GO. La presenza del file o il suo test
non costituiscono prova di runtime Cloudflare.


### CF-03 — Service Worker: navigazioni Auth fuori dall'app shell (14/11/2026)

La registrazione Workbox della PWA intercettava ogni navigazione GET
non esclusa e poteva restituire `index.html` al posto della
callback OAuth, anche dopo un futuro deployment del Worker API. Il
perimetro condiviso `src/lib/pwaHttpNavigationBoundary.ts` esclude
dal fallback `/api/auth` e `/v1` (inclusi i figli), così
un codice di autorizzazione Kinde non viene scambiato per un documento
offline, e un endpoint API mancante fallisce attraverso HTTP invece di
mostrare la pagina applicativa. Le shortcut
`/?tab=training` e le pagine pubbliche non cambiano. La
suite Vitest esercita la regex production e verifica l'integrazione
nel vero `src/sw.ts`; restano da verificare il comportamento
di WebKit/iOS installato, il rilascio PWA e l'API Auth effettivamente
montata. Nessuna route Auth pubblica viene abilitata da questo diff.


### CF-05 — accesso HTTP alle chiavi ADK, solo candidato (14/11/2026)

Il Worker API candidato `cloudflare/api/worker.mjs` integra due nuove route
`POST /v1/cloud-key/sync` e
`POST /v1/cloud-key/rights-export`. Richiedono sessione Kinde
verificata e D1 corrente tramite `AUTH_GATE`, token CSRF,
origin esatto, nessun corpo e guardia di consenso specifica. Una chiave
viene restituita al browser soltanto dopo controlli D1 primari pre/post
decifratura; dopo la revoca rights-only è lettura di ADK preesistente,
mai nuova emissione. Risposta in formato compatibile con
`thelogbook-account-data-key`, senza cache o telemetria.
Test integrati in M7 su SQLite sintetica con API e AuthGate autentici.

**Non attivo in rete:** `cloudflare/wrangler.jsonc` non espone
queste route né contiene binding D1/KEK. Le migrazioni 0001–0008 sono state installate **solo nella sandbox D1 EU**;
non sono stati configurati segreti KEK né collaudata la route;
 servono ancora custodia e
recupero KEK indipendenti, completo contratto erasure/rights, consenso
client, journal e session lifecycle Kinde, WAF/quote e prove reali
iOS/Workers/D1. I test Node e la CI non attestano runtime cloud.

### CF-02 — D1 schema e binding API privato (14/11/2026)

Read-back diretto Cloudflare: sandbox D1
`thelogbook-cf02-eu-isolated-20261113` con `jurisdiction=eu`,
primaria `EEUR`, read replication disattivata e registro
`d1_migrations` da 0001 a 0008. Le tabelle di principal/sessioni,
consenso/revoca/cancellazione, custodia ADK e tentativi OAuth sono presenti.
L'identità, i documenti e la ricevuta **sintetici** precedenti non sono stati
alterati; nuove tabelle Auth/OAuth vuote. Un bookmark Time Travel precedente
alle migrazioni è stato acquisito, ma nessun restore è stato eseguito.
Il provider rifiuta `PRAGMA integrity_check` via REST: prova non eseguita.

Il Worker frontend live resta distinto dal backend. Le configurazioni
`cloudflare/api/wrangler.isolated.jsonc` e
`cloudflare/auth/wrangler.isolated.jsonc` vincolano il D1 isolato
a due servizi privati senza URL pubblici e senza DNS. La pipeline
`.github/workflows/cloudflare-api-isolated.yml` distribuisce solo
da una `main` verificata e controlla i binding live dopo il deploy.
La presenza della pipeline non è prova di esecuzione: per dichiarare
"binding collegato" servono run riuscita e readback provider.
Non certifica Auth Kinde, HTTP runtime, sincronizzazione o release PWA.
