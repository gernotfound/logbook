# Registro dei servizi esterni — stato corrente TheLogBook

**Classificazione: CRITICAL.** Questo registro contiene **soltanto servizi necessari, ancora presenti nel codice oppure da validare prima del GO**. La storia delle configurazioni superate rimane nella cronologia Git e nelle PR. GitHub prova SHA e verifiche; i provider provano le rispettive risorse e il runtime. Un riscontro datato non autorizza cambi Production.

## Target Cloudflare / Kinde

| Servizio | Stato osservato / perimetro | Gate prima del GO |
|---|---|---|
| **Kinde Identity** | Business `thelogbook.kinde.com`, regione Irlanda selezionata nell'onboarding; screenshot del 14/11: ambiente `Production — Not live`, 0 utenti, app iniziale `My React App` **Front-end and mobile**, Email e Google selezionati. App server-side `Back-end web` raccomandata per la sessione Worker/D1, **non ancora creata o verificata**. [Dettagli onboarding](kinde-auth-setup.md). | Verificare l'app server-side, Email + password (non solo codice email), minimo 15 caratteri su signup/reset, Google OAuth, callback reali e sessioni, antiabuso/MFA, DPA/retention, quote Free, erasure e Safari. Nessun dato salute in Kinde. |
| **Cloudflare Workers Static Assets** | Worker `thelogbook-frontend`, binding `ASSETS`; unica esposizione pubblica autorizzata per sviluppo: `https://thelogbook.me`. Il repository disabilita `workers.dev` e preview; verificare che il provider abbia applicato il cutover. | UI completa, update PWA, cache/Safari, privacy e smoke; non equivale a Auth/API pubblicata. |
| **Cloudflare Workers API** | Codice Worker, session gate/issuer, consenso, replica e verificatori Kinde nel repository; **nessuna API Worker Auth/D1 pubblicata** nel controllo provider disponibile. | Endpoint OIDC reali e limitati, binding isolati, rate limiting, test runtime e integrazione client/consenso/chiavi. |
| **Cloudflare D1** | Sandbox `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu`, read replication disattivata; migration `0001`/`0002` applicate e lette sul provider con dati sintetici. Migrazioni ulteriori solo nel repository. | Database e binding di destinazione, auth/consent/erasure, quota Free, backup/restore e giurisdizione dell'istanza effettiva. `eu` non prova localizzazione di Workers, log o OAuth. |
| **Cloudflare DNS / IONOS** | Zona `thelogbook.me` attiva; passaggio web da A/AAAA IONOS verso Workers Custom Domain autorizzato il 14/11/2026. Registrare separatamente l'esito provider e preservare invariati MX, DKIM, DMARC e gli altri record email IONOS. | TLS/route e smoke del sito pubblico; OAuth/posta Production e nuovo backend rimangono esclusi da questa autorizzazione. |

## Dipendenze del codice legacy da sostituire

| Servizio | Stato verificato / limite | Prossima azione tecnica |
|---|---|---|
| **Firebase Authentication / Firestore / App Check** | Import e chiamanti frontend/Rules sono ancora nel repository; l'Hosting Firebase storico è disabilitato secondo attestazione del proprietario. L'assenza di account/dati da migrare non dimostra equivalenza del nuovo runtime. | Portare login, autorizzazione, consenso, sync, cifratura, logout, diritti ed erasure e rimuovere codice/config/test obsoleti **solo dopo prove equivalenti**; non riattivare Hosting. |
| **Vercel Functions/Cron + Firebase Admin** | Il progetto `logbook` risultava sospeso dall'ultima lettura del provider. `vercel.json.git.deploymentEnabled=false` per ogni branch; Functions/Cron e test di supporto sono ancora presenti nel repository. | Convertire ogni endpoint e cron con limiti CPU Workers Free, poi rimuovere chiamanti, credenziali e provider con inventario/mandato specifico. Nessun deploy Vercel per inerzia. |

## Sistemi tecnici e privacy

- **GitHub:** repository, PR, `Canonical Verification`, CodeQL, gate post-merge e review. CI verde non certifica provider o runtime.
- **Google OAuth:** nel target passa da Kinde. Le vecchie origin/redirect Firebase non sono configurazioni automaticamente valide per Kinde; test browser e redirect reali prima del GO.
- **Ricerca e indicizzazione:** Google Search Console richiede URL canonico, robots/sitemap e verifica proprietà da riallineare dopo cutover; non è backend di fitness.
- **Analytics ed error monitoring:** nessun SDK esterno di telemetria automatica del client deve essere reintrodotto senza decisione di prodotto. Log tecnici provider da valutare per minimizzazione e retention.
- **Fornitori email dismessi:** nessuna dipendenza operativa nel target. Gli account sono stati dichiarati chiusi dal proprietario e i record DNS dedicati sono stati eliminati e verificati su Cloudflare; l'eventuale retention delle vecchie console non è stata controllata indipendentemente. Nessuna riattivazione o attività di collaudo del vecchio percorso.

## Verifiche e confini

**Decisione 14/11/2026:** `thelogbook.me` è autorizzato come unico dominio di sviluppo pubblico del frontend, con `workers.dev` e preview disabilitati. Questa eccezione esplicita riguarda solo il web/DNS, **non** il GO funzionale. Il rilascio completo richiede conferme distinte per **Auth/email/Google, consenso sanitario, owner isolation, cifratura e chiavi, sync/ACK e offline, import/export, cancellazione e inattività, quote/rate, privacy, backup, PWA iOS, CI e rollback**. Niente spese, upgrade, dati Production, OAuth/posta Production o eliminazioni irreversibili senza autorizzazione appropriata.

**Fonti:** [runbook Cloudflare](cloudflare-workers-migration.md), [AGENTS](../../AGENTS.md), [servizi esterni](../../.agents/rules/external-services.md), [CI](../../.agents/rules/ci-verification.md), [epic #1053](https://github.com/gernotfound/logbook/issues/1053), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057), [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063), [hosting #1041](https://github.com/gernotfound/logbook/issues/1041).
