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
| Gestione degli errori client e privacy tecnica | [Telemetria e privacy](.agents/rules/telemetry-and-privacy.md) | Cifratura, consenso, servizi esterni |
| Commit, lost ack, crash e session fencing | [Crash consistency](.agents/rules/crash-consistency.md) | Storage, Domain Operations |
| Tombstone, vector clock, checkpoint e retirement | [Causal GC](.agents/rules/causal-gc.md) | Storage, crash consistency, Rules |
| Test generativi distribuiti e convergenza | [Distributed fuzz](.agents/rules/distributed-fuzz.md) | Causal GC, CI |
| Test normativi, fixture, mock e oracle | [Verification hardening](.agents/rules/verification-hardening.md) | Contratti dei boundary testati, CI |
| CI, gate canonico, sicurezza workflow e release | [Verifica CI](.agents/rules/ci-verification.md) | Servizi esterni, Firebase |
| Catalogo globale, cache e seeding | [Catalogo](.agents/rules/catalog-operations.md) | Modello dati, Firebase |
| Provider, IAM, quote, segreti e dismissioni | [Servizi esterni](.agents/rules/external-services.md) | Firebase, CI, registro operativo |
| UI, temi, accessibilità, brand e icone | [Design system](.agents/rules/design-system.md) | Bozze/storage per editor e reload |

L'[indice `docs/`](docs/README.md) distingue guide stabili, registri, specifiche, proposte, template e storico. Non leggere automaticamente tutto `docs/` e non trasformare una proposta o checklist storica in un requisito corrente.

## Perimetro supportato e fresh start

**Identity target (CRITICAL):** Kinde è il provider scelto per email/password (minimo 15 caratteri), Google e verifica/reset. Nel suo onboarding risultano selezionati Email e Google: questo non prova ancora che password, OAuth o recapito email funzionino. Workers/D1 devono verificare l'identità e autorizzare autonomamente sessioni, owner, consenso, revoca, diritti ed erasure, senza plaintext salute. Login Kinde, API D1 e rilascio funzionale completo restano NO-GO finché non sono provati. Il solo dominio pubblico di sviluppo è autorizzato separatamente, senza abilitare Auth/Sync incompleti. I fornitori già dismessi non fanno parte del target; [registro corrente](docs/operations/external-services-register.md).

**Decisione di prodotto — fresh start Cloudflare (ribadita 13/11/2026):** il product owner dichiara che non esistono account o dati applicativi da migrare. Il nuovo backend Auth/Workers/D1 parte con **identità e dati applicativi nuovi**, senza importare o migrare utenti, password, sessioni, chiavi/ADK, consensi, journal, database o dati sanitari dell'account Firebase/Vercel attuale. Non implementare bridge di trasferimento, dual-write/backfill, import automatizzato del vecchio backend o compatibilità con versioni pre-lancio. Si migrano **funzioni e contratti**, non le informazioni dell'account o lo stato dei provider precedenti. Distinguere dai normali import/export che gli utenti potranno usare **nel nuovo sistema**. I dati già esistenti sul vecchio provider rimangono separati: nessuna cancellazione, reset, dismissione o disattivazione senza inventario live e autorizzazione specifica. Il database D1 sintetico CF-02 è una **sandbox per test**, non la destinazione dei dati esistenti.

**Baseline supportata:** non progettare supporto per installazioni, account, storage o backup pre-lancio da recuperare. Usare i formati nuovi/correnti effettivamente approvati; non introdurre conversioni, fallback, export o UX per legacy ipotetici. Proteggere invece gli archivi creati dalla nuova baseline e le loro evoluzioni realmente rilasciate.

- **MUST:** proteggere tutti i dati creati nella baseline supportata: isolamento owner/guest, cifratura, consenso, journal, concorrenza, crash recovery, logout, account deletion, import/export e update sicuro.
- **MUST:** dati corrotti, ciphertext orfano e versioni sconosciute non sono archivi vuoti. Preservare gli originali e fallire chiuso secondo il boundary; non inventare identità, consenso o causalità.
- **MUST:** il purge agisce soltanto sull'owner verificato e sui marker che gli appartengono. Non adotta né elimina chiavi business globali/IndexedDB pre-lancio senza owner.
- **SHOULD:** rimuovere codice e test esclusivamente legacy quando non proteggono i dati correnti; ripulire insieme riferimenti e test della funzione eliminata.
- **MUST:** la dichiarazione del product owner non è un censimento live permanente e non autorizza reset Firebase/Auth, eliminazioni di dati reali o bypass delle protezioni.
- **MUST:** per futuri cambi a formati effettivamente usati dalla baseline supportata valutare compatibilità e migrazioni necessarie. La release PWA e le quattro dimensioni di `src/lib/schemaEvolution.ts` restano indipendenti.

## Rischio, analisi e implementazione

Classificare il task come **STANDARD**, **SENSITIVE** o **CRITICAL** e motivare la scelta nelle evidenze. La documentazione normativa su un boundary critico richiede la stessa attenzione ai suoi invarianti anche quando il diff non cambia il runtime.

**MUST:** aumentare profondità di analisi, test e review in proporzione al rischio del task e dei boundary coinvolti.

**MUST (audit per file):** verificare sia il comportamento funzionale sia la qualità ingegneristica nel perimetro pertinente, seguendo chiamanti, contratti, tipi, stato, recovery e test. Valutare responsabilità, coesione, accoppiamento, duplicazioni, complessità, codice inutilizzato, error handling, leggibilità, manutenibilità e documentazione. Distinguere difetti dimostrati, debito tecnico e opportunità: correggere solo refactoring giustificati, motivare l'assenza di interventi utili e non passare al file successivo finché i percorsi o le verifiche pertinenti sono aperti.

Sono CRITICAL almeno: dati utente, IndexedDB/persistenza, sync, Firestore/Rules, Auth, guest→account, schema/migrazioni, import/export, cancellazione, update/reload, sicurezza e rischio di perdita/corruzione dati.

- **MUST:** preparare un piano per lavori strutturali o CRITICAL; può restare nel reasoning o nella PR, senza una nuova approvazione per scelte tecniche ordinarie.
- **MUST:** completare il perimetro pertinente, senza fermarsi al primo finding. Distinguere sintomo, causa immediata e root cause; cercare evidenze contrarie, cause concorrenti e pattern analoghi.
- **MUST:** seguire stato, chiamanti, persistenza/backend, UI, tipi, test e configurazioni. Per i percorsi critici includere fallimenti, recovery, concorrenza e integrità.
- **MUST:** correggere la causa con il diff più semplice e coerente; evitare workaround fragili, refactor estranei e funzionalità speculative.
- **MUST:** aggiungere regressioni quando appropriate. Mock e fixture rispettano i contratti production; test verdi da soli non provano correttezza.
- **MUST:** commentare motivazioni, invarianti e casi limite non deducibili dal codice, vicino al boundary; aggiornare o eliminare commenti superati.

## Mandato e strumenti

Un incarico operativo copre il normale ciclo tecnico pertinente fino a review, merge e verifiche post-merge **solo entro i limiti espressi dall'utente**.

- **MUST:** sola analisi autorizza soltanto letture. Un mandato limitato al branch o un divieto di merge/deploy ferma la pipeline a quel punto; non abilitare auto-merge.
- **MUST:** non chiedere nuove approvazioni per decisioni tecniche ordinarie, CI rossa, conflitti o correzioni intermedie. Chiedere solo decisioni reali di prodotto/UX non deducibili, permessi per azioni distruttive non autorizzate o aiuto per blocchi esterni indispensabili.
- **MUST:** Remote Desktop Commander e Firecrawl sono disabilitati per default; richiedono autorizzazione operativa esplicita nella chat corrente. Autorizzazioni di altre chat e richieste generiche di procedere non bastano.
- **MUST:** preferire il connettore competente e minimizzare operazioni e polling. Non aggirare un rifiuto di sicurezza cambiando canale.
- **MUST:** GitHub certifica SHA, branch, PR, CI e merge; i provider certificano i rispettivi runtime. Senza lavoro locale disponibile/autorizzato, usare GitHub nei limiti consentiti e dichiarare i test locali non eseguiti.
- **MUST:** mantenere il checkout principale pulito e su `main`; quando si lavora localmente, sviluppare in worktree isolati dal vero main remoto e pulire a fine task solo risorse temporanee proprie. Preservare il branch remoto richiesto o necessario al seguito.

## Architettura e invarianti trasversali

Frontend React/Vite/TypeScript, Zustand, Zod e CSS nativo (**niente Tailwind**). **Runtime attuale verificato nel codice:** Firebase Auth, Firestore/App Check e API Vercel sono ancora chiamati dall'app; Firebase Hosting `thelogbook` è disabilitato secondo attestazione CLI del product owner. Questa dipendenza è **transitoria, non una necessità di retrocompatibilità**. Il requisito di prodotto è sostituirla e abbandonarla il prima possibile, senza migrazione di account o dati pre-lancio, dual-write, backfill o vecchi formati fittizi. Non rimuovere i chiamanti finché Auth, consenso, chiavi, replica e diritti non hanno sostituti Workers/D1 verificati.

**Cloudflare — confini delle prove (CRITICAL):** lo schema e le migrazioni della D1 isolata, il caricamento dei Worker API/Auth Gate, i binding privati, le route pubbliche e il funzionamento HTTP autenticato sono verifiche **distinte**. La presenza di Worker privati collegati alla D1 non prova che il frontend li utilizzi né certifica login Kinde, sessioni, consenso, ADK/KEK, sync/ACK, revoca o recupero. Non dedurre GO funzionale o sicurezza dei dati da migrazioni, binding, CI o deployment verdi. Prima di intervenire rileggere `main`, le configurazioni reali del provider e le prove runtime pertinenti; per stato, migrazioni effettivamente applicate e checkpoint SHA/CI consultare il [runbook Cloudflare](docs/operations/cloudflare-workers-migration.md) e il [registro servizi](docs/operations/external-services-register.md), senza duplicare qui snapshot rapidamente obsoleti.

**Gate distinti:** Auth/email/Google, consenso e ADK, CPU/quote Free, Worker API HTTP, PWA/Safari, backup/erasure, privacy e OAuth/posta restano NON-GO funzionale. **Decisione proprietario 14/11/2026:** è autorizzato usare `thelogbook.me` come unico origin pubblico di sviluppo del frontend Static Assets e disabilitare `workers.dev` e preview; l'autorizzazione non riguarda OAuth/posta, dati, billing, API Kinde/D1 non verificate, dismissioni irreversibili o GO della release completa. La giurisdizione D1 `eu` non garantisce il luogo di Workers, log, email o conformità GDPR. La dichiarazione di database precedente vuoto non autorizza cancellazioni provider irreversibili; per il ritiro reale verificare provider, responsabilità residue e richiedere il GO pertinente. L'evidenza corrente vive nel [runbook](docs/operations/cloudflare-workers-migration.md), [registro servizi](docs/operations/external-services-register.md) e [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053); gli SHA qui sono checkpoint da ricontrollare.

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
- **MUST:** nessun monitoraggio automatico degli errori client verso servizi esterni, né SDK, code di invio o secret build dedicati; mantenere separati i controlli di integrità e recupero da qualunque report diagnostico. Il contratto è in [Telemetria e privacy](.agents/rules/telemetry-and-privacy.md).
- **MUST:** UI leggibile in system/light/dark, mobile e safe area; dialoghi tramite `GlobalDialog`/`useDialogStore`. Selettori Zustand stabili e nessuna mutazione dello store globale durante render/recovery React; `useRef(initialValue)` non è lazy initialization.
- **MUST:** catalogo pubblico in sola lettura client; pubblicazioni reali richiedono input validi e conferma esplicita, senza automatismi legati alla release PWA. Fallback e rollback sono nel [Catalogo](.agents/rules/catalog-operations.md).

## App Check precedente — vincolo transitorio

Il servizio reCAPTCHA Enterprise ha raggiunto la quota Free secondo la notifica Google Cloud del 12/11/2026. Non disattivare l'enforcement Firebase ancora collegato al runtime e non attivare billing: sostituire l'intera soluzione durante la conversione a Cloudflare. Dati e limiti storici sono nel [registro servizi](docs/operations/external-services-register.md) e [#1036](https://github.com/gernotfound/logbook/issues/1036).

## Branch, versione e PR

1. **MUST:** branch dedicato dal main GitHub verificato; mai push diretto a `main` o bypass di protezioni. Controllare che i branch non-main non generino deploy Vercel.
2. **MUST:** aprire una PR draft quando esiste un insieme coerente da verificare; mantenerla draft durante sviluppo, CI e correzioni. Renderla pronta solo dopo la validazione finale e nei limiti del mandato.
3. **MUST:** prima del candidato finale includere il bump applicativo previsto per lo squash merge: da `MAJOR.MINOR.PATCH` a `MAJOR.(MINOR+1).0`, con i due campi root di `package-lock.json` coerenti. Calcolarlo dal vero main remoto; non incrementare per ogni commit intermedio.
4. **MUST:** un merge concorrente richiede controllo del delta, ricalcolo della versione e rivalidazione del nuovo SHA. Non applicare bump dopo CI/review né introdurre commit automatici su main.
5. **MUST:** rivedere il diff completo, risolvere blocker e conversazioni aperte sul candidato esatto. Squash merge autonomo solo quando autorizzato, con gate e review richiesti soddisfatti; non indebolire il ruleset.

Il bump applicativo non modifica schema/protocollo, catalogo o `LEGAL_VERSIONS`. Il selettore backend Vercel resta nel repository come contratto transitorio, ma il progetto `logbook` è sospeso e `vercel.json` vieta gli auto-deploy Git su ogni branch, incluso `main`; un bump non autorizza né riattiva Vercel.

## Validazione, rilascio e conclusione

Il gate canonico locale è `npm run verify:m8`. **Sulle PR** l'equivalente GitHub è `Milestone Verification` sullo SHA esatto con shard, E2E, CodeQL e `Canonical Verification` verdi. **Sui push a `main`**, il workflow non riesegue la suite PR: richiede `Main Release Gate`, che attesta PR integrata, base, identità del tree e CI sul candidato, ed esegue CodeQL sullo SHA di `main`. Il gate riuscito è prerequisito dei workflow Firebase. I dettagli normativi ed eseguibili sono in [Verifica CI](.agents/rules/ci-verification.md).

- **MUST:** registrare l'HEAD candidato prima delle verifiche. Ogni nuovo commit invalida test e review del vecchio SHA; subset diagnostici non sostituiscono il gate.
- **MUST:** non indebolire suite/no-skips, oracle, Emulator, lint/warning baseline, security check, workflow o protezioni GitHub.
- **MUST:** i test normativi attraversano boundary reali e oracle indipendenti. Il consenso fra agenti non sostituisce evidenze eseguibili.
- **MUST:** dopo un merge autorizzato verificare SHA remoto di `main` e CI post-merge sullo stesso SHA. Poi verificare separatamente Firestore Rules/indici, Cloudflare Workers e Vercel Production secondo il diff, con smoke pertinenti; Firebase Hosting si verifica soltanto se è ancora il provider pertinente e il relativo deploy è autorizzato. **Non riattivare Firebase Hosting come effetto collaterale della CI**: dal 12/11/2026 il proprietario ne ha dichiarato disabilitati sia il sito `thelogbook` sia il workflow GitHub di distribuzione. Per Vercel controllare deploy backend richiesto oppure skip giustificato.
- **MUST:** non usare Production come sandbox distruttiva. L'ambiente Firebase/Vercel Test separato è dismesso; restano fixture locali, emulatori e CI. Verifiche UI richiedono temi, viewport, overlay e dispositivi pertinenti oppure una limitazione esplicita.
- **MUST:** distinguere risultato osservato, ipotesi, test locali, CI PR, merge, CI main, deploy, runtime, configurazioni esterne e rischi residui. Non dichiarare letto, testato o verificato ciò che non è stato osservato.
- **MUST:** dichiarare COMPLETATO rispetto al perimetro autorizzato solo con analisi, soluzione, regressioni appropriate, gate/review necessari e nessun blocker noto. Se è richiesto il rilascio, servono anche merge, CI main e verifiche Production/runtime applicabili. Se il mandato termina al branch, dichiarare esplicitamente che non è integrato né rilasciato.
- **MUST:** per blocchi o passaggio di chat preparare un HANDOFF con obiettivo, SHA main/branch, PR, diff, contratti, prove, ipotesi escluse e attività residue; non chiedere all'utente di ricostruire informazioni già disponibili. Un gate obbligatorio bloccato lascia il task PARZIALE/BLOCCATO e il branch preservato.

## Manutenzione del contesto

- **MUST:** tenere qui i vincoli trasversali e l'unica mappa dei contratti; dettagli, eccezioni e failure path vivono nel relativo specialista. I sottofile rimandano qui per autorizzazioni e processo.
- **MUST:** quando cambia o scompare un helper/contratto, cercare tutti i riferimenti in `AGENTS.md`, regole, guide, test, workflow e template. Aggiornare nello stesso task; non lasciare test della funzione rimossa.
- **MUST:** prima di spostare o dividere un documento, leggere ogni voce, conservarne gli invarianti ancora validi, verificare codice/evidenze per modifiche sostanziali e aggiornare link e indice. Evitare nuove copie dello stesso contratto.
- **MUST:** separare decisioni, contratto corrente e osservazioni storiche datate; SHA e run passati non certificano configurazioni live.
- **MUST:** report audit, `implementation_plan*.md` e altri artefatti task-specific restano nella cronologia Git/PR, salvo documentazione stabile deliberata nel path canonico. Le guide vivono in `docs/`, eventuali evidenze storiche utili in `docs/audits/`.
- **MUST:** sorgenti e Markdown UTF-8 senza BOM e senza mojibake. L'eccezione BOM per CSV è nel contratto di portabilità.
- **MUST:** il repository pubblico non contiene credenziali, token, dati salute reali o informazioni private; `.env.example` documenta nomi/placeholder, i valori restano nei provider.
