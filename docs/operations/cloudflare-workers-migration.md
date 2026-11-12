# Cloudflare Workers Static Assets — candidato pre-cutover

**Stato verificato GitHub (12/11/2026):** codice preparatorio integrato in `main` tramite [PR #1039](https://github.com/gernotfound/logbook/pull/1039), SHA `e37616d92a9b4d6a1e8408358b136f74a2d169f7`; **nessun deployment Cloudflare attestato**. Checklist autorevole [#1041](https://github.com/gernotfound/logbook/issues/1041); incidente quota Hosting [#1036](https://github.com/gernotfound/logbook/issues/1036). L'autorizzazione a disattivare Firebase Hosting è stata comunicata dal proprietario il 12/11/2026, ma **non attesta l'esecuzione** e non autorizza implicitamente il cutover G01.

## Scelta tecnica e limiti

- Il build Vite continua a generare il frontend; Cloudflare pubblica `dist/` come asset statici senza invocazioni Worker per i file esistenti.
- L'unico namespace dinamico deliberato è `/__/auth/*`: un proxy HTTPS verso il dominio standard `logbook-db-98cc4.firebaseapp.com`. Non usa `thelogbook.web.app`, evita redirect 302 verso l'helper e serve il fallback Google su Safari. Il Worker rifiuta metodi non previsti, payload grandi e richieste a path estranei; non accetta host upstream controllati dal client e non registra informazioni personali.
- `/__/auth/iframe` è incorporato dalla pagina: **non** usare `X-Frame-Options: DENY` o `frame-ancestors 'none'` sulle risposte proxy. Le risposte **statiche** continuano invece a usare la CSP e gli header dell'attuale `firebase.json`.
- L'upstream Auth `firebaseapp.com` resta collegato ai servizi Firebase Hosting dello stesso progetto: la sua disponibilità in presenza di quota Hosting esaurita **non è confermata**. Prima del cutover serve verifica reale; il proxy non rende autonomi gli helper OAuth.
- Il candidato invia `X-Robots-Tag: noindex`; rimuoverlo solo nel cutover autorizzato e validato.
- Gli asset statici Cloudflare non consumano richieste Worker; le invocazioni del proxy Auth e le richieste non-asset possono consumare la quota gratuita e restituire 429 dopo l'esaurimento. Nessuna garanzia SLA Enterprise o invulnerabilità DDoS.
- Una URL `workers.dev` non fornisce automaticamente le stesse regole WAF personalizzabili di una zona con dominio proprio. Nessun dominio a pagamento è richiesto.

## Checkpoint onboarding — 12/11/2026 (fonte distinta: proprietario / schermata / provider)

- **IONOS:** il proprietario conferma l'acquisto di `thelogbook.me`; rinnovo, blocco trasferimento, DNSSEC e record DNS non sono ancora stati verificati nel registrar. Il nome target scelto per il futuro frontend pubblico è `thelogbook.me` (apex), con `www` da reindirizzare al canonico solo dopo test.
- **Cloudflare:** la schermata fornita dal proprietario mostra account Workers & Pages presente, nessun progetto e sottodominio allocato `califano-ger.workers.dev`. Il proprietario afferma di aver attivato la **2FA**: recupero 2FA, membri/ruoli, piano effettivo, certificati, DNS e impostazioni di sicurezza restano da controllare nel provider. Non pubblicare l'Account ID, un token o dati di fatturazione nel repository.
- **Ricognizione DNS 12/11/2026 (screenshot proprietario):** IONOS mostra 11 record e la scansione iniziale Cloudflare ne aveva importati 8. La successiva schermata Cloudflare prova che i CNAME DKIM `s1-ionos._domainkey` e `s2-ionos._domainkey` sono stati salvati con target IONOS corretti e **DNS only**; anche `autodiscover`, `_dmarc`, `_domainconnect` sono ora **DNS only**. La lista Cloudflare nello screenshot mostrava **10 record**. In un messaggio successivo, il proprietario ha **confermato di avere salvato** in Cloudflare il TXT IONOS `_dep_ws_mutex` copiato direttamente dal provider, senza comunicarne il valore. **Gli 11 record risultano quindi dichiarati presenti, ma non è ancora stata osservata una tabella finale Cloudflare che li attesti tutti**. Restano da verificare priorità MX e DNSSEC/DS prima della delega NS. **Non attestati:** undicesimo record salvato, parità completa della zona, DNSSEC, nameserver cambiati o dominio attivo su Cloudflare.
- **Origine candidato proposta (non ancora live):** `https://thelogbook-frontend.califano-ger.workers.dev` combina il nome Worker in `wrangler.jsonc` con il sottodominio assegnato; non è un URL verificato HTTP. Il valore GitHub `CLOUDFLARE_APP_ORIGIN` deve coincidere esattamente con l'origin **effettivamente assegnato** dopo il deploy. `CLOUDFLARE_ACCOUNT_ID` è una GitHub Variable; `CLOUDFLARE_API_TOKEN` un Secret con privilegi minimi. Non incollare i valori in chat o issue.
- **Utenti / migrazione dati:** il proprietario conferma che il prodotto non è pubblicato e non esistono utenti della PWA da migrare. Non costruire portabilità specifica di installazioni pre-lancio inesistenti. Proteggere comunque dati/archivi creati nella baseline supportata durante i collaudi.
- **Autorizzazioni:** disattivazione Firebase Hosting richiesta/autorizzata dal proprietario; disattivazione non ancora eseguita e stato runtime da verificare. Il cutover pubblico **G01** rimane una decisione separata e non è stato autorizzato soltanto dal setup del dominio. Non eliminare il progetto Firebase, Authentication, Firestore, App Check o Vercel.
- **Blocco tecnico prima di spegnere Hosting:** `cloudflare/auth-proxy.mjs` usa ancora l'upstream `logbook-db-98cc4.firebaseapp.com`, origin collegato agli helper di Firebase Hosting. `firebase hosting:disable` interrompe il servizio Hosting del sito indicato; non garantisce che `/__/auth/*` resti raggiungibile. Prima di disabilitare operativamente, adottare un helper indipendente verificato o registrare il fermo del login in sviluppo e il ripristino previsto; impedire al workflow automatico Firebase Hosting di riattivare il sito. **Non interpretare l'autorizzazione come prova di disattivazione effettiva.**

### Sequenza IONOS → Cloudflare (zona DNS, senza cutover anticipato)

1. Da **Cloudflare Domains**, aggiungere `thelogbook.me` come zona completa, selezionando il piano **Free** (senza nuovo acquisto/trasferimento di registrar). Lasciare `Workers & Pages > Create application` inutilizzato finché il deployment tramite GitHub non è pronto.
2. Inventariare e conservare una copia privata dei record DNS IONOS esistenti (in particolare MX, TXT/SPF, DKIM e DMARC qualora presenti); verificare che l'importazione/scansione Cloudflare li riproduca. Non inviare credenziali o record con token sensibili in issue pubbliche.
3. Verificare DNSSEC/DS nel registrar e disattivare la vecchia firma se attiva **prima** di delegare a nuovi nameserver; attendere la propagazione indicata dai provider.
4. Dal pannello IONOS, **Domini & SSL → thelogbook.me → Name server → Utilizza name server personali**, inserire **solo i due NS assegnati alla zona da Cloudflare**, non valori di esempio. Confermare/valutare effetti su eventuali servizi email prima del salvataggio.
5. Verificare stato **Active** della zona Cloudflare, NS autoritativi, TLS e record risolti; creare un Worker con il workflow GitHub candidato esatto SHA su `workers.dev`, non tramite template/dashboard manuale che divergano dal codice versionato.
6. Solo dopo il candidato, i test Auth/App Check, provider e autorizzazione G01: collegare `thelogbook.me` come **Worker Custom Domain**, valutare `www`, SEO, WAF e accesso `workers.dev` per evitare bypass. Un custom domain Workers crea DNS/certificato Cloudflare; non richiede SSL a pagamento IONOS.

**Fonti tecniche:** [Cloudflare zone DNS Free](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/), [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [IONOS nameserver](https://www.ionos.it/aiuto/domini/utilizzare-un-proprio-name-server/utilizzare-un-proprio-name-server-per-un-dominio/), [Cloudflare DNSSEC](https://developers.cloudflare.com/dns/dnssec/), [Firebase Hosting disable](https://firebase.google.com/docs/cli), [Firebase Auth helper reserved URLs](https://firebase.google.com/docs/hosting/reserved-urls).

## Configurazione esterna necessaria (senza segreti in Git)

1. Creare un account Cloudflare sul piano Workers Free e conoscere la sottodirectory `workers.dev`. Il nome Worker configurato è `thelogbook-frontend`; verificare che l'origine risultante sia quella impostata.
2. Impostare nella repository GitHub Variable `CLOUDFLARE_APP_ORIGIN` l'esatto origin HTTPS assegnato, senza slash finale. Impostare `CLOUDFLARE_ACCOUNT_ID` tra le Variables e `CLOUDFLARE_API_TOKEN` tra i Secrets, con permessi di deploy Worker limitati a **un solo account**. Non inviare i valori in issue/chat.
3. Mantenere le attuali variabili GitHub `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, `VITE_ACCOUNT_DELETION_API_ORIGIN`. Il build Cloudflare imposta `VITE_FIREBASE_AUTH_DOMAIN` all'hostname del nuovo origin. Non cambiare la Browser API key né eliminare le 25 API già autorizzate.
4. Registrare il nuovo hostname come dominio autorizzato Firebase Authentication, origine JavaScript OAuth e URI di callback `https://<origin>/__/auth/handler` ove necessario. Verificare le impostazioni reali della chiave reCAPTCHA Enterprise/App Check e le restrizioni dei referrer della Browser API key **prima** dei test reali. Non disattivare App Check.
5. Il backend Vercel usa ancora `PUBLIC_APP_ORIGIN` con un solo origin di produzione; pianificare una modifica coordinata in cutover o una breve finestra di test con CORS esplicitamente valutato. Le API cloud-key, consenso ed eliminazione account **non** sono verificate dal semplice smoke HTTP statico.

## Rilascio candidato, non cutover

Il workflow `Cloudflare Workers Static Assets Candidate` è **solo manuale su main**. Non viene eseguito dai branch né dopo ogni merge. Richiede in input lo SHA esatto di `main`, attesta prima un run Firestore Production riuscito per quello SHA, esegue il build in job senza token Cloudflare e passa un artifact dello stesso run al job di deploy. Controlla SHA remoto immediatamente prima della pubblicazione. Non modifica Firebase Hosting né le configurazioni Vercel/Firebase.

Il build sostituisce i metadati HTML con l'origin Cloudflare **prima** di generare il Service Worker precache; riscrive solo `robots.txt` e `sitemap.xml` dopo il build, poiché non sono nella precache. L'origin Firebase attuale rimane canonico nel build Firebase pre-cutover.

## Gate obbligatori prima della transizione definitiva

- Review, Canonical Verification, CodeQL, gate M8 sullo stesso SHA; Firestore Production e deploy Cloudflare devono essere attestati separatamente.
- Smoke asset con confronto byte, MIME, CSP, cache, fallback SPA, /__/auth senza fallback HTML, 404 reali di JS/CSS inesistenti, analisi traffico Worker/free quota.
- Browser reali: Google popup + redirect (incluso Safari iOS), email/password, reset/verifica mail, App Check e Firestore, Vercel CORS/preflight, account consent/erasure/deletion, recovery delle chiavi, guest→account, multi-tab.
- PWA install, offline, aggiornamento con barriera durevole, responsive light/dark, recupero di archivi locali. **IndexedDB e Service Worker sono origin-scoped**: i dati guest presenti sotto il vecchio dominio non appaiono automaticamente nel nuovo; occorre verificare la portabilità corrente con export/import, senza purgare alcunché.
- Prima di rimuovere il vecchio frontend, considerare eventuale Service Worker installato che potrebbe ancora fornire la shell cached: un semplice redirect HTTP non lo disattiva.
- Soltanto dopo autorizzazione esplicita del proprietario: cambiare canonical, Vercel redirect, `PUBLIC_APP_ORIGIN`, provider OAuth/App Check/API key e pipeline automatiche; disattivare il vecchio deployment Firebase Hosting in modo verificabile. **Non eliminare** progetto Firebase, Firestore, Auth, chiavi, backend Vercel o secret.

## Rollback

Prima del cutover l'ambiente autorevole resta Firebase. Dopo il cutover il rollback deve utilizzare un precedente deploy Cloudflare compatibile con provider/origin correnti; la quota Firebase Hosting esaurita non è un piano di continuità affidabile. Se i gate esterni falliscono, non dichiarare completata la migrazione: lasciare PR/issue aperte con evidenze e blocker.
