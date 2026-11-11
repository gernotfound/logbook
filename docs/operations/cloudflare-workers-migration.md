# Cloudflare Workers Static Assets — candidato pre-cutover

**Stato:** preparazione su branch; questo documento non attesta un deploy. Il vecchio Firebase Hosting resta attivo fino ad autorizzazione esplicita del proprietario. Issue: [#1036](https://github.com/gernotfound/logbook/issues/1036).

## Scelta tecnica e limiti

- Il build Vite continua a generare il frontend; Cloudflare pubblica `dist/` come asset statici senza invocazioni Worker per i file esistenti.
- L'unico namespace dinamico deliberato è `/__/auth/*`: un proxy HTTPS verso il dominio standard `logbook-db-98cc4.firebaseapp.com`. Non usa `thelogbook.web.app`, evita redirect 302 verso l'helper e serve il fallback Google su Safari. Il Worker rifiuta metodi non previsti, payload grandi e richieste a path estranei; non accetta host upstream controllati dal client e non registra informazioni personali.
- `/__/auth/iframe` è incorporato dalla pagina: **non** usare `X-Frame-Options: DENY` o `frame-ancestors 'none'` sulle risposte proxy. Le risposte **statiche** continuano invece a usare la CSP e gli header dell'attuale `firebase.json`.
- Gli asset statici Cloudflare non consumano richieste Worker; le invocazioni del proxy Auth e le richieste non-asset possono consumare la quota gratuita e restituire 429 dopo l'esaurimento. Nessuna garanzia SLA Enterprise o invulnerabilità DDoS.
- Una URL `workers.dev` non fornisce automaticamente le stesse regole WAF personalizzabili di una zona con dominio proprio. Nessun dominio a pagamento è richiesto.

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
