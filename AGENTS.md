# TheLogBook — istruzioni operative per agenti AI

Ambito: soltanto la PWA TheLogBook (`gernotfound/logbook`). Il product owner decide prodotto e priorità; l'agente risolve autonomamente le questioni tecniche dimostrabili e comunica in italiano comprensibile anche a chi non programma.

## Autorità e convenzioni

**Questo è il file comandante del contesto repository.** Definisce autorizzazioni, processo e invarianti trasversali. I contratti in [`.agents/rules/`](.agents/rules/) lo specializzano; non possono allargare il mandato o contraddirlo. Le istruzioni applicabili dell'ambiente e i limiti espliciti della richiesta restano prioritari.

- **MUST / MUST NOT:** obbligo / divieto.
- **SHOULD:** preferenza forte; una deroga richiede motivazione tecnica esplicita.
- **MAY:** possibilità ammessa entro il contratto, non autorizzazione a cambiare dati o provider.
- **VERIFY:** acquisire evidenze prima di affermare il fatto.
- **NOTE:** contesto informativo o storico, non ordine esecutivo.

Una regola descrive il comportamento richiesto, non prova che sia implementato o distribuito. Codice, test, commenti e documentazione possono divergere: indagare prima di riallinearli. Non modificare il codice alla cieca per soddisfare una regola obsoleta.

## Prima di ogni task

1. **MUST:** leggere su GitHub l'HEAD reale di `main` e registrarne lo SHA. Leggere questo file, i contratti pertinenti sotto e implementazione, chiamanti, tipi, test, workflow e configurazioni coinvolti.
2. **MUST:** verificare se esistono già branch o PR del task; riprendere il lavoro coerente dopo aver confrontato SHA e diff, evitando duplicati.
3. **MUST:** distinguere lo SHA di `main`, lo SHA candidato del branch e lo stato dei provider. Un clone, una chat precedente o una nota datata non certificano lo stato remoto.
4. **MUST:** se `main` avanza, esaminare il delta e valutarne l'impatto prima di proseguire o dichiarare valido il candidato. Non sovrascrivere lavori concorrenti né integrare automaticamente modifiche estranee.
5. **MUST:** verificare direttamente i provider pertinenti quando il task riguarda configurazioni live o rilascio; se l'accesso manca, dichiarare precisamente quale prova manca.

Versioni dipendenze/runtime, comandi, formati persistiti, token CSS e nomi delle variabili hanno fonte nei file eseguibili. Evitare copie di questi valori nel contesto quando basta un riferimento.

## Mappa dei contratti

I sottofile **non sono caricati automaticamente** in tutti gli ambienti: aprirli esplicitamente. Se il task attraversa più aree, leggere l'unione dei contratti. I rimandi non limitano la ricerca del codice.

| Area del task | Contratto da leggere | Integrare quando pertinente |
|---|---|---|
| Storage, journal, hydration, replica, update/reload | [Storage e sync](.agents/rules/storage-and-sync.md) | Crash consistency, cifratura, bozze, account, consenso |
| Vault device, chiavi cloud, ciphertext e provisioning | [Archivio e cifratura](.agents/rules/secure-storage.md) | Storage, account, consenso, Firebase |
| Workout/timer, editor, bozze e testimoni fra schede | [Bozze e stato device](.agents/rules/device-drafts.md) | Storage, cifratura, modello dati, consenso |
| Nuovi campi, Zod, root e shard mensili | [Modello dati](.agents/rules/data-model-and-zod.md) | Domain Operations, storage, backup, Rules |
| Mutazioni business, reducer e compiler | [Domain Operations](.agents/rules/domain-operations.md) | Modello dati, crash consistency |
| Backup JSON, import/restore, share e CSV | [Portabilità](.agents/rules/backup-and-portability.md) | Storage, cifratura, bozze, consenso |
| Auth, guest→account, logout e cancellazione account | [Ciclo account](.agents/rules/account-lifecycle.md) | Storage, consenso, cifratura, Firebase |
| Consenso salute, offline, diritti e cancellazione soli dati | [Consenso salute](.agents/rules/health-consent.md) | Account, storage, backup, Firebase |
| Firebase env, App Check, Rules/indici, domini e CSP | [Configurazione Firebase](.agents/rules/firebase-config.md) | Cifratura, consenso, CI, servizi esterni |
| Analytics Cloudflare, gestione errori client e privacy tecnica | [Telemetria e privacy](.agents/rules/telemetry-and-privacy.md) | Cifratura, consenso, servizi esterni |
| Commit, lost ack, crash e session fencing | [Crash consistency](.agents/rules/crash-consistency.md) | Storage, Domain Operations |
| Tombstone, vector clock, checkpoint e retirement | [Causal GC](.agents/rules/causal-gc.md) | Storage, crash consistency, Rules |
| Test generativi distribuiti e convergenza | [Distributed fuzz](.agents/rules/distributed-fuzz.md) | Causal GC, CI |
| Test normativi, fixture, mock e oracle | [Verification hardening](.agents/rules/verification-hardening.md) | Contratti dei boundary testati, CI |
| CI, gate canonico, sicurezza workflow e release | [Verifica CI](.agents/rules/ci-verification.md) | Servizi esterni, Firebase |
| Catalogo globale, cache e seeding | [Catalogo](.agents/rules/catalog-operations.md) | Modello dati, Firebase |
| Provider, IAM, quote, segreti e dismissioni | [Servizi esterni](.agents/rules/external-services.md) | Firebase, CI, registro operativo |
| UI, temi, accessibilità, brand e icone | [Design system](.agents/rules/design-system.md) | Bozze/storage per editor e reload |

L'[indice `docs/`](docs/README.md) distingue contratti, decisioni, guide, template e storico. Per la migrazione usare [quadro Cloudflare](docs/operations/cloudflare-current-state.md) e issue; verificare provider/ledger live e non ripetere candidati integrati né trattare snapshot come requisiti correnti. Leggere solo i documenti pertinenti.

## Perimetro supportato e fresh start

**Identità scelta: Kinde (CRITICAL)** per email/password (minimo 15 caratteri), Google e verifica/reset. Il frontend pubblico monta solo l'ingresso account identity-only, non il fitness Workers/D1. Login datati non provano reset, linking, consenso, sync o Safari/iOS. Consultare [stato operativo](docs/operations/cloudflare-current-state.md) e [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057); release funzionale completa **NO-GO**.

**Fresh start Cloudflare (decisione del proprietario):** non ci sono account o dati applicativi da trasferire nel nuovo backend. Migrare funzioni e contratti, **non** utenti, password, sessioni, chiavi/ADK, consensi, journal o dati salute Firebase/Vercel. Vietati bridge, dual-write, backfill, import automatici e compatibilità con installazioni pre-lancio inesistenti. Import/export futuri del nuovo sistema sono distinti; D1 sintetica è una sandbox.

- **MUST:** proteggere guest locale, account, consenso, cifratura, journal, offline, multitab/multi-device, crash recovery, import/export, revoca, cancellazione e update PWA della baseline realmente supportata.
- **MUST:** dati corrotti, ciphertext orfani e versioni sconosciute non sono archivi vuoti; preservare la prova, fallire chiuso e non inventare owner, consenso o causalità.
- **MUST:** purge solo sull'owner verificato e sui suoi marker; non adottare/eliminare chiavi business globali o IndexedDB pre-lancio.
- **MUST:** proteggere formati effettivamente usati dalla nuova baseline e migrarli quando necessario; le dimensioni di `src/lib/schemaEvolution.ts` restano indipendenti dalla versione PWA.
- **MUST:** l'assenza storica di utenti non è un censimento live né autorizza reset, eliminazione o dismissione dei provider senza inventario e permesso specifico.
- **SHOULD:** rimuovere codice, test e riferimenti esclusivamente legacy dopo aver dimostrato che non proteggono dati o funzioni supportate.

## Rischio, analisi e implementazione

Classificare **STANDARD**, **SENSITIVE** o **CRITICAL**. Sono CRITICAL Auth, salute/consenso, cifratura/chiavi, IndexedDB, sync, D1/Firestore, schema/migrazioni, import/export, backup/restore, cancellazione, update PWA e sicurezza. Anche il riordino delle istruzioni critiche richiede preservazione degli invarianti.

- **MUST:** pianificare lavori strutturali/CRITICAL con profondità proporzionale al rischio. La review indipendente non è automatica per classe: è richiesta solo da ruleset, mandato o vincolo esterno verificato.
- **MUST:** seguire chiamanti, UI, stato, tipi, persistenza/backend, configurazioni, test e workflow; cercare crash, race, retry, recovery, cause concorrenti ed evidenze contrarie, distinguendo sintomo, root cause, debito e opportunità. Non passare oltre con percorsi pertinenti ancora irrisolti.
- **MUST:** correggere la causa radice con il diff più semplice, senza workaround fragili, refactor estranei o compatibilità speculative.
- **MUST:** aggiungere regressioni appropriate con fixture e mock fedeli a produzione e oracle indipendenti; test verdi non bastano.
- **MUST:** commentare vicino al codice motivazioni, invarianti e casi limite non deducibili, aggiornando o eliminando commenti superati.

## Qualità architetturale e modularità

Obiettivo: moduli coesi, contratti verificabili, provider sostituibili e dipendenze chiare, senza microservizi o livelli artificiali. [ADR-4](docs/architecture/cloudflare-provider-seams.md) descrive i confini candidati; norme specialistiche in [Domain Operations](.agents/rules/domain-operations.md), [Modello dati](.agents/rules/data-model-and-zod.md), [Storage](.agents/rules/storage-and-sync.md) e [Test](.agents/rules/verification-hardening.md).

- **MUST:** separare dominio, casi d'uso, UI/stato React e infrastruttura; estrarre o accorpare solo per motivi reali di cambiamento, evitando conglomerati e pass-through inutili.
- **MUST:** dominio e trasformazioni pure indipendenti da React/Zustand/provider; adapter e orchestratori dipendono dai contratti applicativi. UI usa Domain Operations per mutazioni ordinarie, con eccezioni bulk/recovery documentate. Autorizzazione nel boundary trusted.
- **MUST:** esplicitare input, output, errori, ownership, stato, epoch e prove di successo; validare input non fidati. Vietati side effect impliciti, singleton senza lifecycle definito e flag ambigui nei boundary critici.
- **MUST:** una sola fonte autorevole per stato e mutazioni, evitando accessi indiscriminati allo store globale; async, logout, revoca, crash, retry e A→B→A non riutilizzano dati/permessi di owner o epoch precedenti.
- **MUST:** sostituire Firebase/Vercel gradualmente con adapter mirati e parità dimostrata; niente doppi writer o fallback legacy permanenti. Rimuovere riferimenti/test obsoleti solo dopo equivalenza e recovery.
- **MUST:** prima di refactoring esaminare dipendenze, side effect, failure path e test. La PR descrive ownership, contratti, regressioni e debito transitorio; l'estrazione di funzioni da sola non prova disaccoppiamento.
- **SHOULD:** guardrail strutturali automatici solo quando verificabili, con test positivi/negativi, senza indebolire CI o sostituire revisione semantica.

## Mandato e strumenti

Un incarico operativo copre il normale ciclo tecnico pertinente fino a verifiche, eventuale review, merge e controlli post-merge **solo entro i limiti espressi dall'utente**.

- **MUST:** sola analisi autorizza soltanto letture. Un mandato limitato al branch o un divieto di merge/deploy ferma la pipeline a quel punto; non abilitare auto-merge.
- **MUST:** non chiedere nuove approvazioni per decisioni tecniche ordinarie, CI rossa, conflitti o correzioni intermedie. Chiedere solo decisioni reali di prodotto/UX non deducibili, permessi per azioni distruttive non autorizzate o aiuto per blocchi esterni indispensabili.
- **MUST:** Remote Desktop Commander e Firecrawl sono disabilitati per default; richiedono autorizzazione operativa esplicita nella chat corrente. Autorizzazioni di altre chat e richieste generiche di procedere non bastano.
- **MUST:** preferire il connettore competente e minimizzare operazioni e polling. Non aggirare un rifiuto di sicurezza cambiando canale.
- **MUST:** GitHub certifica SHA, branch, PR, CI e merge; i provider certificano i rispettivi runtime. Senza lavoro locale disponibile/autorizzato, usare GitHub nei limiti consentiti e dichiarare i test locali non eseguiti.
- **MUST:** mantenere il checkout principale pulito e su `main`; quando si lavora localmente, sviluppare in worktree isolati dal vero main remoto e pulire a fine task solo risorse temporanee proprie. Preservare il branch remoto richiesto o necessario al seguito.

## Architettura e invarianti trasversali

**Runtime e migrazione:** frontend React/Vite/TypeScript, Zustand, Zod e CSS nativo (niente Tailwind). Il bootstrap pubblico è guest + Kinde identity-only; fitness account Workers/D1 isolato. Firebase/Firestore/App Check e Vercel restano transitori nei chiamanti; non rimuoverli senza sostituti verificati. Verificare sempre codice, [ADR-4](docs/architecture/cloudflare-provider-seams.md) e [stato operativo](docs/operations/cloudflare-current-state.md).

**Cloudflare — prove distinte (CRITICAL):** schema/migrazioni D1, Worker, binding, route, HTTP autenticato, sessioni Kinde, consenso, ADK/KEK, ACK, erasure e restore richiedono evidenze indipendenti. CI o deploy riusciti non dimostrano GO o comportamento pubblico. Verificare provider; [quadro operativo](docs/operations/cloudflare-current-state.md) e [runbook](docs/operations/cloudflare-workers-migration.md) sono checkpoint datati.

- **MUST:** nessun dato salute in chiaro lato server; nessun ACK inventato, bypass di consenso o downgrade di cifratura. La sessione Kinde e la prova legale non sono sostituite da un risultato SQL o da un token del browser.
**Gateway di confine:** la risposta del Worker privato D1 non può impostare cookie o redirect; soltanto Kinde può controllare la sessione browser. Una risposta D1 anomala è errore fail-closed, mai ACK implicito. Il gateway non sostituisce Auth/consenso/ADK verificati nei Worker privati.

**Gate NO-GO:** Auth/email/Google, consenso e ADK, Workers/D1 fitness, quote Free, PWA/Safari, backup/erasure, privacy e OAuth/posta richiedono prove e GO specifici. `thelogbook.me` è autorizzato come origin di sviluppo Static Assets, non per billing, dati reali, nuovi servizi pubblici o dismissioni. `jurisdiction=eu` D1 non localizza Workers, log, email/OAuth né dimostra conformità GDPR.

- **MUST:** il nome pubblico è TheLogBook; non rinominare namespace tecnici/persistiti storici per uniformarli al marchio senza un cambiamento di contratto esplicito.
- **MUST:** offline operare solo dalla copia locale e dalla sessione/consenso già autorizzati. L'assenza del backend non autorizza downgrade plaintext, primo consenso implicito o ACK inventati.
- **MUST:** le normali mutazioni UI/hook attraversano Domain Operations. Business state e journal diventano durevoli nello stesso commit IndexedDB prima della replica; snapshot-save solo nei boundary bulk/recovery espliciti.
- **MUST:** owner, epoch Auth, generazione guest e revisione consenso sono prove distinte. Ricontrollare i guard dopo le attese e **dentro** le callback transazionali critiche; lo stesso UID dopo A→B→A non prova continuità.
- **MUST:** nessuna Promise critica fallisce silenziosamente. Rifiuto remoto, esito ambiguo e conferma locale/cloud restano distinguibili; lost ack è recuperabile solo con prova durevole dell'intero batch.
- **MUST:** vault device e chiave cloud sono indipendenti, casuali e owner-scoped. Nessuna password/PIN/codice di recupero aggiuntivo nella UX ordinaria; UID, token e API key non sono chiavi crittografiche. Non promettere E2EE o recupero di copie solo offline dopo perdita totale del profilo.
- **MUST:** il consenso guest non si trasferisce all'account. Revoca sospende il fitness e preserva i percorsi diritti; riaccettazione locale offline non autorizza il cloud né rietichetta il journal precedente.
- **MUST:** logout/purge preservano i gate di integrità e i dati di altri owner; la cancellazione account è gestita dal server, elimina per ultima l'identità Auth del provider in uso e richiede prova server `complete` prima della pulizia locale.
- **MUST:** `localWorkout` device e `activeWorkout` cloud sono distinti; il fetch remoto non sovrascrive una sessione locale attiva. Timer basati su timestamp/delta; date business `YYYY-MM-DD` locali tramite helper canonico, istanti evento UTC/epoch.
- **MUST:** tutti gli ingressi persistiti attraversano formato/versioni e gateway Zod applicabili. Nessun valore non serializzabile nel backend (Firestore/D1), identità inventata o normalizzazione con perdita risigillata come autorevole.
- **MUST:** reload/update passa dalla barriera di persistenza di ogni scheda. Stato RAM senza envelope leggibile blocca il reload; nessuna navigazione automatica dal solo cambio Service Worker.
- **MUST (decisione di prodotto):** Cloudflare Web Analytics Free è autorizzato in prospettiva per metriche aggregate, **non attivato automaticamente**; prima verificare quote, privacy e consenso applicabile ([#1202](https://github.com/gernotfound/logbook/issues/1202)). Vietati salute, identità, sessioni, credenziali e contenuti; non riattivare GA4/Firebase/Vercel Analytics, error monitoring esterno o session replay. [Telemetria](.agents/rules/telemetry-and-privacy.md).
- **MUST:** UI leggibile in system/light/dark, mobile e safe area; dialoghi tramite `GlobalDialog`/`useDialogStore`. Selettori Zustand stabili e nessuna mutazione dello store globale durante render/recovery React; `useRef(initialValue)` non è lazy initialization.
- **MUST:** catalogo pubblico in sola lettura client; pubblicazioni reali richiedono input validi e conferma esplicita, senza automatismi legati alla release PWA. Fallback e rollback sono nel [Catalogo](.agents/rules/catalog-operations.md).

## App Check precedente — vincolo transitorio

Non disattivare l'App Check/enforcement Firebase ancora necessario al codice legacy e non attivare billing. Sostituire solo dopo equivalenza Workers verificata; storico nel [registro servizi](docs/operations/external-services-register.md) e [#1036](https://github.com/gernotfound/logbook/issues/1036).

## Branch, versione e PR

1. **MUST:** branch dedicato dal main GitHub verificato; mai push diretto a `main` o bypass di protezioni. Controllare che i branch non-main non generino deploy Vercel.
2. **MUST:** aprire una PR draft quando esiste un insieme coerente da verificare; mantenerla draft durante sviluppo, CI e correzioni. Renderla pronta solo dopo la validazione finale e nei limiti del mandato.
3. **MUST:** prima del candidato finale includere il bump applicativo previsto per lo squash merge: da `MAJOR.MINOR.PATCH` a `MAJOR.(MINOR+1).0`, con i due campi root di `package-lock.json` coerenti. Calcolarlo dal vero main remoto; non incrementare per ogni commit intermedio.
4. **MUST:** un merge concorrente richiede controllo del delta, ricalcolo della versione e rivalidazione del nuovo SHA. Non applicare bump dopo la CI o un'eventuale review né introdurre commit automatici su main.
5. **MUST:** rivedere il diff completo, risolvere blocker e conversazioni aperte sul candidato esatto. Squash merge autonomo solo quando autorizzato e con i gate effettivamente richiesti soddisfatti; non imporre review indipendenti supplementari per prassi e rispettare le approvazioni richieste dal ruleset o dal mandato esplicito.

Il bump applicativo non modifica schema/protocollo, catalogo o `LEGAL_VERSIONS`. Il selettore backend Vercel resta nel repository come contratto transitorio, ma il progetto `logbook` è sospeso e `vercel.json` vieta gli auto-deploy Git su ogni branch, incluso `main`; un bump non autorizza né riattiva Vercel.

## Validazione, rilascio e conclusione

Il gate canonico locale è `npm run verify:m8`. **Sulle PR** l'equivalente GitHub è `Milestone Verification` sullo SHA esatto con shard, E2E, CodeQL e `Canonical Verification` verdi. **Sui push a `main`**, il workflow non riesegue la suite PR: richiede `Main Release Gate`, che attesta PR integrata, base, identità del tree e CI sul candidato, ed esegue CodeQL sullo SHA di `main`. Il gate riuscito è prerequisito dei workflow Firebase. I dettagli normativi ed eseguibili sono in [Verifica CI](.agents/rules/ci-verification.md).

- **MUST:** registrare l'HEAD candidato prima delle verifiche. Ogni nuovo commit invalida test ed eventuali review del vecchio SHA; subset diagnostici non sostituiscono il gate.
- **MUST:** non indebolire suite/no-skips, oracle, Emulator, lint/warning baseline, security check, workflow o protezioni GitHub.
- **MUST:** i test normativi attraversano boundary reali e oracle indipendenti. Il consenso fra agenti non sostituisce evidenze eseguibili.
- **MUST:** dopo un merge autorizzato verificare SHA remoto di `main` e CI post-merge sullo stesso SHA. Poi verificare separatamente Firestore Rules/indici, Cloudflare Workers e Vercel Production secondo il diff, con smoke pertinenti; Firebase Hosting si verifica soltanto se è ancora il provider pertinente e il relativo deploy è autorizzato. **Non riattivare Firebase Hosting come effetto collaterale della CI**: dal 12/11/2026 il proprietario ne ha dichiarato disabilitati sia il sito `thelogbook` sia il workflow GitHub di distribuzione. Per Vercel controllare deploy backend richiesto oppure skip giustificato.
- **MUST:** non usare Production come sandbox distruttiva. L'ambiente Firebase/Vercel Test separato è dismesso; restano fixture locali, emulatori e CI. Verifiche UI richiedono temi, viewport, overlay e dispositivi pertinenti oppure una limitazione esplicita.
- **MUST:** distinguere risultato osservato, ipotesi, test locali, CI PR, merge, CI main, deploy, runtime, configurazioni esterne e rischi residui. Non dichiarare letto, testato o verificato ciò che non è stato osservato.
- **MUST:** dichiarare COMPLETATO rispetto al perimetro autorizzato solo con analisi, soluzione, regressioni appropriate, gate obbligatori ed eventuali approvazioni effettivamente richieste, senza blocker noti. Se è richiesto il rilascio, servono anche merge, CI main e verifiche Production/runtime applicabili. Se il mandato termina al branch, dichiarare esplicitamente che non è integrato né rilasciato.
- **MUST:** per blocchi o passaggio di chat preparare un HANDOFF con obiettivo, SHA main/branch, PR, diff, contratti, prove, ipotesi escluse e attività residue; non chiedere all'utente di ricostruire informazioni già disponibili. Un gate obbligatorio bloccato lascia il task PARZIALE/BLOCCATO e il branch preservato.

## Manutenzione del contesto

- **MUST:** tenere qui i vincoli trasversali e l'unica mappa dei contratti; dettagli, eccezioni e failure path vivono nel relativo specialista. I sottofile rimandano qui per autorizzazioni e processo.
- **MUST:** quando cambia o scompare un helper/contratto, cercare tutti i riferimenti in `AGENTS.md`, regole, guide, test, workflow e template. Aggiornare nello stesso task; non lasciare test della funzione rimossa.
- **MUST:** prima di spostare o dividere un documento, leggere ogni voce, conservarne gli invarianti ancora validi, verificare codice/evidenze per modifiche sostanziali e aggiornare link e indice. Evitare nuove copie dello stesso contratto.
- **MUST:** separare decisioni, contratto corrente e osservazioni storiche datate; SHA e run passati non certificano configurazioni live.
- **MUST:** report audit, `implementation_plan*.md` e altri artefatti task-specific restano nella cronologia Git/PR, salvo documentazione stabile deliberata nel path canonico. Le guide vivono in `docs/`, eventuali evidenze storiche utili in `docs/audits/`.
- **MUST:** sorgenti e Markdown UTF-8 senza BOM e senza mojibake. L'eccezione BOM per CSV è nel contratto di portabilità.
- **MUST:** il repository pubblico non contiene credenziali, token, dati salute reali o informazioni private; `.env.example` documenta nomi/placeholder, i valori restano nei provider.
