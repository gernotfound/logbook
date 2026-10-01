# Servizi esterni e configurazione fuori repository

Questa regola disciplina i sistemi esterni la cui configurazione effettiva non è rappresentata integralmente dal repository Git.

Il registro decisionale stabile e leggibile anche fuori dal codice è `docs/operations/external-services-register.md`.

## Fonte di verità

- **MUST:** codice/config repository e stato del provider esterno sono fonti di verità separate. Non dedurre la configurazione live dal solo repository.
- **MUST:** prima di cambiare un'integrazione esterna, verificare quando possibile lo stato live nel sistema competente: GitHub, Vercel, Firebase/Google Cloud, Sentry, Snyk o Google Search Console.
- **MUST:** quando cambia materialmente un'impostazione esterna, aggiornare nello stesso task il registro dei servizi oppure indicare esplicitamente perché non può ancora essere aggiornato.
- **MUST:** distinguere gli stati `ACTIVE`, `LEGACY`, `OPTIONAL`, `EXTERNAL-ONLY` e `VERIFY-LIVE`. Un'impostazione riportata storicamente non prova lo stato runtime corrente.

## Boundary privacy del repository pubblico

Il repository è pubblico.

- **MUST NOT:** committare valori segreti, auth token, private key, credenziali service account, email personali, identificativi di fatturazione/account, username della workstation o path filesystem personali.
- **MUST:** documentare nomi e scopo delle environment variable, non i valori segreti.
- **MUST:** non tracciare snapshot `.env.production` o equivalenti con valori reali del deployment. Il contratto pubblico vive in `.env.example`; i valori Production vivono nel provider di deployment.
- **SHOULD:** evitare di duplicare nella documentazione identificativi/site key client pubblici quando nome e ruolo sono sufficienti.
- **MUST:** esempi e fixture di test usano identità e path sintetici.
- **MUST:** se un valore privato viene esposto, ruotarlo/revocarlo presso il provider e ripulire lo stato repository corrente dove praticabile; cancellare un messaggio o aggiungere un commit successivo non sostituisce la rotazione.

## Ritiro servizi e allowlist

- **MUST:** origin e domini di deployment ritirati vengono rimossi dalla configurazione applicativa e dalle allowlist esterne quando non sono più necessari.
- **MUST:** non mantenere autorizzato un vecchio origin per sola compatibilità storica se nessun runtime reale lo usa.
- **MUST:** prima di eliminare una funzione generica di portabilità, dimostrare che sia specifica del provider ritirato. Il supporto generico a base path/subpath non è automaticamente codice legacy di deployment.
- **VERIFY:** restrizioni referrer API key, origin/redirect OAuth, domini autorizzati Firebase Auth, domini reCAPTCHA/Fraud Defense e proprietà Search Console sono stato esterno.

## Boundary dei provider

### Firebase / Google Cloud

Firebase Authentication, Firestore, Firebase Admin e App Check sono boundary distinti anche quando condividono lo stesso progetto Google Cloud.

- Seguire `.agents/rules/firebase-config.md` per contratti env client/server, App Check e Rules.
- Nel candidato di migrazione, Firebase Hosting + Cloud Functions v2 sono il target di delivery; il deploy Production resta vietato finché il candidato non viene approvato e mergiato su `main`.
- Google Cloud può presentare reCAPTCHA Enterprise dentro il prodotto più ampio Fraud Defense. LogBook usa attualmente il provider reCAPTCHA Enterprise tramite Firebase App Check; non dichiarare attive Account defense, SMS defense, transaction defense o API Fraud Defense dirette senza evidenza live.
- Le restrizioni Browser API key e la configurazione OAuth sono controlli di sicurezza esterni e devono essere riesaminati quando cambia l'origin canonico di deployment.
- Google Analytics for Firebase è un boundary opzionale distinto da Sentry: richiede opt-in esplicito, proprietà/data stream e `measurementId` verificati live. Google Signals, advertising personalization e collegamenti Ads non vanno considerati attivi senza evidenza esplicita.
- Retention, data sharing e impostazioni regionali Google Analytics sono stato esterno e devono essere verificate prima del cutover; il codice non deve compensare configurazioni console ignote con default permissivi.
- La Web data stream GA4 target mantiene la Misurazione avanzata disabilitata nel primo rilascio. Scroll, outbound click, site search, download, form e video non vengono raccolti automaticamente finché il product owner non decide di ampliare la tassonomia e la documentazione privacy.

### Vercel

- Fino al cutover approvato Vercel può ancora servire la Production precedente, ma non è una dipendenza del candidato.
- `vercel.json` disabilita i deployment Git automatici nel target clean-cut; branch, PR e il futuro `main` del candidato non devono creare nuovi deployment Vercel.
- Dopo il cutover, env/credenziali/integrations Vercel residue vanno revocate nel provider quando non sono più necessarie.
- Lo stato storico Vercel non prova il runtime Firebase e non sostituisce la CI GitHub.

### GitHub / CodeQL / Snyk

- GitHub è la fonte di verità per repository, PR/ruleset e CI canonica.
- CodeQL fa parte di `Canonical Verification`; Snyk è supplementare e non deve diventare l'unico controllo SAST bloccante.
- Ruleset e required check sono stato GitHub esterno: verificarli direttamente prima di cambiare nomi dei check o comportamento di merge.

### Sentry

- Sentry resta Error Monitoring soltanto, salvo futura decisione esplicita di prodotto.
- Non attivare accidentalmente Session Replay, tracing, logging o Application Metrics seguendo wizard/onboarding.
- I token auth Sentry sono segreti build-only; il DSN browser è configurazione runtime pubblica ma non va duplicato inutilmente.
- Seguire `docs/telemetry-sentry-guide.md` per minimizzazione payload e source map.

### Google Search Console

- Search Console è un sistema di verifica/indicizzazione, non una dipendenza runtime dell'app.
- Mantenere coerenti URL Production canonico, metodo di verifica, `robots.txt` e `sitemap.xml`.
- Non rimuovere file/meta di verifica solo perché l'indicizzazione è già riuscita: la proprietà potrebbe dover essere riverificata in futuro.

## Review richiesta quando cambia un provider

Prima di sostituire, rimuovere o riconfigurare materialmente un servizio esterno:

1. identificare chiamanti e dipendenza runtime correnti;
2. verificare la configurazione live del provider;
3. identificare impatto dati/privacy/sicurezza;
4. identificare assunzioni su quota/free tier e comportamento in failure;
5. aggiornare codice/config/test;
6. aggiornare questa regola se cambia un invariante;
7. aggiornare `docs/operations/external-services-register.md` con motivo della decisione e data di verifica.
