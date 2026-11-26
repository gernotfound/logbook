# TheLogBook — migrazione Cloudflare: runbook corrente

> **26/11/2026:** consultare prima il [quadro operativo corrente](cloudflare-current-state.md), che sostituisce gli snapshot storici come fonte di stato. Il ledger remoto più recente è riportato soltanto nel quadro operativo e va verificato sul provider prima di ogni operazione; non dedurlo dal codice candidato. Non confondere build/deploy con applicazione schema. La decisione atomica di inattività e lo scheduler enqueue persistente 0017 sono candidati; il nuovo ingresso scheduled `inactivity-enqueue` richiede un secondo opt-in distinto da quello generale e il pin recovery esterno. Il manifesto non configura flag, cron o route. La regressione quota D1 per ogni boundary SQL verifica fail-closed e ripresa sintetica, non il consumo live; per il GO restano misure righe/CPU, policy di budget per cron e preflight quota. Il dispatcher account ha backoff SQL per owner nella 0020, ancora senza collaudo provider. Il boundary marker HTTP è candidato, non chiamato dal browser. Nessun cron attivo.

## CF-06 — Verificare lo schema candidato di cancellazione account

- Il workflow applicativo manuale `cloudflare-d1-isolated-migrations.yml`
  verifica il `main` remoto, il gate del relativo SHA e l'impronta della
  migrazioni additive `0012`–`0020`. Per la D1 EU già usata per collaudare
  l'identità Kinde, `upgrade_existing_test_db_0020` richiede un prefisso
  contiguo `0011`–`0020` e tabelle nuove ancora vuote. La 0014 aggiunge
  il checkpoint dello scheduler; la 0015 aggiunge il contatore di assegnazione, inizialmente zero. La 0016 aggiunge il checkpoint diagnostico inizialmente inutilizzato, con lease e generazioni. La 0017 aggiunge il checkpoint enqueue separato, anch'esso inizialmente inutilizzato; il preflight e readback rifiutano un checkpoint già usato. Nessun mount dello scanner enqueue. La 0018 impone il cap di cinque membership D1 valide senza modificare le 16 coordinate causali; il preflight rifiuta owner oltre cap con un conteggio aggregato. La 0019 aggiunge la modalità esplicita al ledger e sostituisce il fence CAS conservando il vincolo scadenza automatico; nessuna modifica a membership storiche, readback di colonna e trigger esatto. La 0020 aggiunge lo stato transitorio di retry per owner con trigger di pulizia terminale, inizialmente vuoto e privo di autorizzazione erasure. Il preflight verifica il controllo inattività iniziale paused/1 anche per ogni prefisso già a 0013 o superiore, prima di qualsiasi scrittura. Nessuna attiva il cron.
  Richiede bookmark Time Travel, repliche disabilitate, identità di
  collaudo presenti e zero consensi, ADK e job sanitari. Il percorso
  predefinito richiede una D1 vuota.
- Il controllo dopo Wrangler verifica schema e ledger, tabelle nuove
  vuote, controllo inattività paused/generation 1, checkpoint scheduler
  iniziale non utilizzato, contatore dispatch a zero, checkpoint dry-run iniziale e inventario invariato
  di identità, sessioni e replica sintetica.
  Se i conteggi cambiano o l'esito è incerto, il workflow si ferma e il
  ledger va riletto prima di ritentare.
- Il workflow di migrazione per il registro recovery verifica
  separatamente `0005`, il suo bookmark e il vincolo
  `sealed` con generazione 1 e zero owner, cutoff e blocchi account.
- I passaggi di schema precedono la prova runtime. La riautenticazione
  dedicata, la cancellazione del profilo, il runner e la ricevuta finale
  sono candidati verificati con dati sintetici. Il collaudo live richiede
  un'identità sintetica, autorizzazione del registro indipendente e
  permessi Kinde dedicati. Il reset di lancio rimane di competenza del
  proprietario.
- La richiesta OAuth usa `prompt=login` e `max_age=0`. Il candidato
  verifica il discovery dello stesso issuer prima del redirect e prima
  dello scambio del codice. I metadati pubblici del tenant di collaudo
  del 24/11/2026 dichiarano `auth_time` e omettono i contesti
  `mfa` e `phr`. In tale configurazione Kinde può usare l'ora di
  emissione del token per `auth_time`. Il flusso di cancellazione può
  proseguire solo quando il callback fidato dispone di una prova di
  riautenticazione. [Contratto Kinde](https://docs.kinde.com/developer-tools/about/using-kinde-without-an-sdk/)

## CF-05 — Recupero ciphertext per export diritti dopo revoca (candidato v2.546.0, 19/11/2026)

Il percorso separato `POST /v1/rights/scan` è una lettura di documenti **cifrati**, autorizzata da sessione Kinde e CSRF, consenso originale D1, job erasure non completato e registro esterno `RECOVERY_DB` ancora aperto senza cutoff. Un controllo SQL first-primary avviene insieme alla pagina bounded di 8 documenti, poi viene ripetuto prima della risposta, insieme al confronto del registro indipendente. La vecchia `/v1/sync/scan` resta vietata agli account ritirati: nessun fallback o grant fitness. Il client `withKindeCandidateRightsCheckpoint()` raccoglie solo una scansione **completa, revision-pinned e AEAD verificata** con ADK `rights-export` effimera, la azzera dopo l'operazione e consegna il checkpoint solo a un consumatore esplicito. Nessun documento in chiaro viene restituito dal server. Sono previste regressioni per una vera modifica cifrata sincronizzata e poi revocata, sessione scaduta, CSRF, owner, scope, cutoff, pagina malformata, cache ed errori di trasporto.

**Limiti:** questo è un componente non montato nel runtime pubblico, non un export JSON/CSV scaricabile; dati rimasti esclusivamente nel dispositivo, journal non confermati e bozze richiedono percorsi distinti. Non esegue erasure finale né aggiunge `D1_API` al frontend pubblicato. La sincronizzazione fitness, Kinde Google/reset, quota Free, prova del provider live, restore KEK e i gate post-merge restano da verificare. Nessun deploy o modifica D1/KEK/OAuth reale in questo incremento.

## CF-05 — Recovery sola lettura della revoca Kinde (candidato v2.545.0, 19/11/2026)

Il percorso candidato `src/lib/auth/kindeCandidateWithdrawal.ts` comprende una riconciliazione read-only dei marker `pending:1` lasciati dopo una risposta perduta di `POST /v1/consent/withdraw`. Un controllo su sessione Kinde originale e `/v1/consent/status` D1 primario può confermare `withdrawn` e avanzare soltanto il marker negativo `withdrawn`, **senza mai ritentare la richiesta distruttiva**, cancellare il marker in caso di `active`, riattivare fitness o inventare l'esito `complete`. Una risposta remota `active` produce `still-unconfirmed`: conserva il blocco e richiede un successivo processo di prodotto esplicito. Una risposta negativa, una sessione cambiata o storage fallito mantiene il blocco locale. Fixture con gli handler reali Workers/AuthGate e schema D1 attuale verificano entrambi i casi di perdita risposta, l'assenza di replay, i marker invalidi e i fallimenti.

**NO-GO invariato:** questa funzione non è montata nella PWA pubblica; il frontend Cloudflare rimane identity-only senza `D1_API`. Non equivale a workflow export dei dati, erasure completa, revoca live collaudata, riaccettazione, eliminazione dell'account o GO Kinde. Non sono stati modificati provider o dati reali. Riferimento [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059).



### CF-04 — Riparazione dopo prima CI: consenso server vs documento fitness

La prima CI del candidato v2.543.0, `Milestone Verification #44515827099`, ha rilevato due fallimenti sulla verifica post-ACK. L'ACK del root cifrato poteva rimettere `legalConsent` vuoto nel vault, pur avendo già verificato il consenso tramite il registro trusted D1. La root cause è distinta dalla consegna a lotti: il root business non è autorità legale. Il bridge D1 propaga ora la prova legale verificata sullo stesso owner/sessione, e l'ACK IndexedDB, all'interno della stessa transazione, conserva quella scelta o fallisce chiuso se la copia locale diverge. Test integrati controllano la preservazione di `legalConsent` dopo primo e secondo lotto, oltre a conservare tutte le modifiche pendenti. I test e i gate devono essere riverificati sul nuovo SHA; il primo candidato CI rosso non costituisce verifica della correzione.

## CF-03/04 — Journal account dopo preparazione Kinde nel candidato React (v2.543.0 proposta, 19/11/2026)

L'azione esplicita `Continua` del percorso **candidato non pubblico** chiama ora il bootstrap con `drainPendingJournal: true`: dopo la conferma trusted di Kinde/consenso, la hydration AEAD e la replica-claim, il bridge consegna o riconcilia le modifiche **già durevoli** nel journal cifrato. Solo `checkpointRevision` valido, `replicaOutcome: adopted | already-active`, `journalOutcome: idle | acknowledged` **e prova `journalDrained: true`** consentono all'interfaccia di mostrare la preparazione completata. L'ACK può confermare soltanto uno dei batch bounded: il bootstrap rilegge l'envelope IndexedDB dopo l'ACK sotto la stessa sessione/vault e, se sopravvivono modifiche `pending` o una consegna staged, restituisce `journal-pending` senza lasciare il vault aperto. La regressione integrata inietta una nuova modifica locale dopo il commit remoto del primo batch, verifica che l'ACK non la rimuova e che una seconda consegna attestata sia necessaria per `journalDrained`. Checkpoint valido senza prova del journal resta **non confermato**, con retry; nessun ACK viene inventato. Le regressioni React coprono esiti journal, claim non risolto, sessione sostituita, guest e provider pubblico escluso. I test isolati esistenti attraversano il vero client Workers/D1 sintetico e il recupero dopo risposta perduta; **non** rappresentano un collaudo live.

Confine invariato: `App.tsx` e `KindeAccountSessionProvider` mantengono l'ingresso identity-only; il frontend Cloudflare non pubblica `D1_API` nell'ultimo readback. Nessun dato utente, KEK o binding provider modificato. Restano **NO-GO** l'installazione owner fitness nel runtime, il ciclo revoca/diritti con UX di export, la prova sul tenant Kinde e i test D1/browser/Safari live. Vedi [CF-03](https://github.com/gernotfound/logbook/issues/1057), [CF-04](https://github.com/gernotfound/logbook/issues/1058) e [CF-05](https://github.com/gernotfound/logbook/issues/1059).

## CF-03/04/05 — Proseguimento React candidato dopo il consenso (v2.542.0 proposta, 19/11/2026)

L'ingresso di test `KindeAccountEntry`, con attivazione esplicita `candidatePreparationEnabled`, offre un solo pulsante `Continua` dopo il **consenso server verificato**: richiama il bootstrap Kinde owner-scoped già presente, con verifica sessione/CSRF/consenso, apertura temporanea del vault, hydration AEAD e replica-claim. Non anticipa l'operazione a una mera presenza Kinde. Il risultato di prova distingue osservazione di checkpoint+replica, consegna non confermata ed errore; una sessione sostituita scarta i risultati tardivi. Il dispositivo non riceve né conserva la KEK.

**NO-GO pubblico invariato:** il provider montato `KindeAccountSessionProvider` resta `identityOnly: true`, `candidatePreparationEnabled: false`, la schermata in `App.tsx` usa ancora `KindeAccountEntry identityOnly` e il frontend Cloudflare non possiede `D1_API` nel readback del 19/11. Questo lavoro collega il passo UX **nella composizione candidata**, non abilita consenso/dati cloud per gli utenti del sito. Servono grant fitness legato al lifecycle, owner/sync con revoca, right/export, cancellazione e collaudi browser/API live isolati prima del GO.

## CF-05 — rehearsal import business del backup Kinde (candidato 19/11/2026)

Il backup completo pre-revoca `kindeCandidatePortableBackup.ts`
non si ferma alla sola validazione `decodeImport`: verifica il ripristino
con `prepareImport(..., 'restore')` su uno stato account vuoto,
riutilizzando l'importer di produzione e un consenso corrente
separato dal JSON. Rifiuta il file se il risultato perde o cambia
un qualsiasi valore dello stato `UserData`. La regressione sul
Worker/D1 sintetico usa un documento cloud sincronizzato, un journal
device non ancora inviato e una bozza, controllando equivalenza completa
del business, isolamento owner e consenso non importato.

**Confine:** questa è una verifica *in memoria* della proiezione di
restore, non un'operazione di import persistita nel vault di un altro
dispositivo. Mancano il commit Kinde in Domain Operations con journal
durevole, la verifica di un ACK cloud e il test del restore effettivo
multi-dispositivo; nessuna API fitness pubblica viene attivata.
La verifica reale della copia KEK continua a richiedere autorizzazione
e un ambiente isolato: non inserire segreti in log, CI o repository.

## CF-05 — Ripristino cold-start di D1 e registro indipendente (candidato 19/11/2026)

La suite `tests/cloudflare/cf05-cloud-key-http.node.mjs` estende
il test precedente: crea due account sintetici, emette due ADK
diverse, salva **due snapshot SQLite autonomi su disco temporaneo**
(D1 applicativa e registro indipendente), chiude le connessioni
originali e riavvia Worker e AuthGate con nuove connessioni.
Per ogni account verifica che KEK assente o diversa (pur essendo
Base64 valida) restituisca errore senza modificare gli envelope
persistiti né i marker di issuance. Solo la KEK sintetica conservata
separatamente nel test può riaprire esattamente entrambe le ADK.
La revoca successiva continua a bloccare fitness ma conserva
l'accesso rights-only finché il job consente la lettura.

Questa prova usa i boundary software correnti, non ripristina né
legge la KEK reale su Cloudflare e **non** dimostra che la copia privata
custodita dal proprietario corrisponda al secret del Worker. Il
restore reale richiede una procedura isolata autorizzata: mai
sostituire il binding Production, esporre la KEK in CI/log, creare
nuove chiavi o agire su account/dati reali per completare il test.

## CF-05 — Ripristino con la stessa KEK sintetica dopo perdita del binding (candidato v2.541.0, 19/11/2026)

La regressione `tests/cloudflare/cf05-cloud-key-http.node.mjs` attraversa gli handler di produzione AuthGate → Worker API → database SQLite con l'intero schema D1 corrente. Dopo il primo consenso e la creazione di una ADK cifrata, simula due nuovi ambienti Worker: KEK assente e KEK valida nel formato ma differente. Entrambi devono restituire errore, senza modificare il ciphertext della ADK o il marker anti-rigenerazione. Un terzo ambiente, che utilizza **la medesima KEK sintetica conservata separatamente nel test**, deve leggere esattamente l'ADK originale, senza creare nuove chiavi. Dopo revoca, il medesimo materiale rimane recuperabile esclusivamente via `rights-export`, mentre il percorso fitness è negato.

**Limite fondamentale:** test sintetico in process su SQLite con gateway/Worker reali; non è un ripristino di segreti Cloudflare, non usa né verifica la copia privata del proprietario, non riapre un backup D1 provider e non certifica un recovery live né l'integrazione PWA/Safari. La KEK reale deve restare fuori da CI/repository/chat; eventuale procedura reale richiede isolare le risorse, proteggere i dati e non sostituire la KEK del Worker esistente. La modalità fitness pubblica rimane NO-GO in [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059).


## CF-05 — Guardrail deploy KEK del Worker privato (candidato v2.540.0, 19/11/2026)

Il workflow `.github/workflows/cloudflare-api-isolated.yml` ora prevede un **preflight read-only Cloudflare** prima di qualunque deploy Worker, dopo la verifica del gate exact-main. `scripts/verify-cloudflare-api-provider.mjs` richiede esattamente un binding `CLOUD_ACCOUNT_KEK_V1` di tipo `secret_text`, oltre a D1, `RECOVERY_DB`, AuthGate e isolamento URL già richiesti. Dopo i deploy ripete la medesima verifica: una KEK accidentalmente persa, cancellata o trasformata in variabile plaintext non può produrre un deploy classificato come riuscito. Le regressioni simulate rifiutano KEK assente, duplicata, non secret e risposte provider errate. **Il preflight non blocca i cambi manuali esterni e non garantisce il valore/backup della KEK**: il restore della stessa chiave resta obbligatorio prima del GO. Nessuna API sanitaria pubblicata, nessun dato o secret modificato da questo incremento.

## CF-05 — KEK Worker installata, restore ancora da attestare (19/11/2026)

**Classificazione CRITICAL; evidenza Cloudflare diretta in sola lettura.** Sul Worker privato `thelogbook-api-isolated` il binding `CLOUD_ACCOUNT_KEK_V1` risulta presente come `secret_text`, anche nella lista separata dei secret. Il Worker conserva `AUTH_GATE`, `DB` e `RECOVERY_DB`. Il frontend `thelogbook-frontend` espone `ASSETS` e `KINDE_HTTP`, **non** `D1_API`: il collegamento del fitness cloud pubblico resta disabilitato.

Il product owner ha dichiarato di aver generato una nuova chiave sul proprio dispositivo e di averne salvato una copia in un luogo riservato, distinto dal Worker. **Non sono stati letti il valore del secret, la copia, né il luogo di custodia; non è stata verificata la corrispondenza fra i valori, la correttezza del formato Base64 né l'effettiva recuperabilità.** La presenza del binding chiude esclusivamente il blocco di configurazione "secret assente"; non prova il ripristino della stessa KEK, il recupero ADK, la cifratura live, il consenso o la replica.

**Gate ancora aperto:** collaudare su ambiente *isolato e dati sintetici* un ciclo di wrapping, riapertura e recupero usando la medesima KEK custodita, senza trasmettere il valore a repository, CI, chat, log o browser e senza sovrascrivere il secret presente. Non eseguire restore D1, modifiche alla KEK in uso o attivazione di `D1_API` per dimostrare questo gate. Le prove software con KEK sintetica documentate nei test esistenti non attestano la copia reale. Vedere [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059) e [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063).


## CF-04 — Chiusura del vault dopo una preparazione incompleta

Se la preparazione Kinde perde la sessione, fallisce o lascia una replica o una consegna da riconciliare, revoca la chiave in memoria del tentativo. Il controllo del vault, il ciphertext e gli intenti persistiti restano disponibili al successivo tentativo autorizzato. Una risposta tardiva può revocare solo la propria apertura del vault, anche quando la nuova sessione appartiene allo stesso account. Solo la conferma del checkpoint e della replica permette al candidato di mantenere l'apertura locale. Questo percorso rimane isolato dalla PWA pubblica.

La consegna del journal verifica la stessa apertura del vault fino all'ACK locale. Una riapertura durante la richiesta della ricevuta D1 interrompe la consegna precedente e conserva l'intero batch sigillato. La consegna successiva recupera la ricevuta esatta senza ripetere il commit.

La modalità esplicita `drainPendingJournal` di `prepareKindeCandidateOwner()` offre al futuro ciclo account Kinde un'unica sequenza: verifica consenso/sessione → sblocco controllato → hydration AEAD → claim della replica → invio delle modifiche già durevoli. È disattivata per impostazione predefinita e non è montata nella PWA pubblica. Se il checkpoint o la replica non sono confermati non trasmette il journal; se la consegna fallisce o resta ambigua chiude soltanto la chiave sbloccata dal tentativo e conserva l'intento cifrato per una nuova riconciliazione. Il campo `journalOutcome` (quando richiesto) descrive la sola consegna residua di quel passaggio: `idle` può seguire il recupero positivo di un vecchio batch. I test usano gateway Workers, SQL D1 sintetico e IndexedDB, non un account Kinde reale. Una regressione aggiuntiva elimina completamente il vault e la chiave device locali, emette una seconda sessione sintetica dello stesso account e verifica il readback cifrato dal cloud e la creazione di una nuova replica, senza duplicare la ricevuta del primo salvataggio.

## CF-04/05 — Ripresa del primo salvataggio account

Il bootstrap Kinde recupera la consegna cifrata già preparata prima di installare un nuovo checkpoint. Dopo un commit con risposta persa, la ricevuta del batch esatto conferma solo le operazioni inviate. Le modifiche successive restano nel journal fino alla rispettiva consegna. Se la ricevuta è indisponibile, il vault resta intatto. Il test di integrazione usa il primo consenso esplicito, la KEK sintetica, il gateway e i Worker applicativi con le due basi SQLite e IndexedDB in memoria. Verifica il blocco in assenza di KEK, la replica e il primo salvataggio. Il collaudo è isolato dal sito pubblico.

## CF-04 — Ripresa della registrazione replica dopo una risposta persa

Il bootstrap candidato Kinde riprende una registrazione replica già salvata nel vault prima di installare un nuovo checkpoint. In precedenza iniziava dalla lettura del checkpoint, che interrompe correttamente l'aggiornamento mentre una richiesta di registrazione è pendente. Il recupero salva la stessa identità replica anche quando D1 ha completato la scrittura e l'app non ha ricevuto la risposta. Se il risultato resta ambiguo, l'archivio cifrato rimane intatto e il bootstrap non pubblica una revisione di checkpoint per quel tentativo.

La regressione attraversa il gateway e i Worker applicativi con uno schema D1 completo in SQLite e IndexedDB in memoria. Simula la perdita della risposta dopo il commit, la riapertura del vault e un conflitto intermedio. È una prova locale isolata. Il collegamento D1 della PWA pubblica e il collaudo browser con Kinde rimangono in [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058) e [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063).

## CF-03/04 — risposte API sanitarie senza controllo della sessione (18/11/2026, candidato v2.522.0)

Il gateway first-party Cloudflare ora rifiuta con 502 una risposta del servizio privato `D1_API` che imposti `Set-Cookie`, `Location` o uno stato HTTP 3xx. Il servizio Kinde rimane l'unico responsabile di cookie e redirect OAuth. Il gateway continua a richiedere `Cache-Control: no-store`, a distinguere un errore HTTP da un ACK e a non esporre dati salute in caso di risposta anomala. Regressioni Node usano il boundary di produzione e verificano rifiuto, nessun cookie/redirect verso il browser e comportamento Kinde invariato. **Nessuna route D1 pubblicata, schema modificato, dato migrato o GO funzionale** da questo intervento.


## CF-05 · empty-body status boundary Cloudflare (17/11/2026, v2.509.0)

Il Worker candidato `/v1/consent/status` rifiutava qualunque `request.body !== null`, incluso uno stream HTTP realmente vuoto inoltrato dal gateway (pattern analogo al 403 precedentemente corretto in Kinde). L'helper condiviso `cloudflare/http/strict-empty-post.mjs` controlla Content-Length ma drena i byte **effettivamente ricevuti**, entro un limite e un timeout, prima di AuthGate/D1. Falsi `Content-Length: 0`, anche con un singolo byte di spazio o NUL, sono respinti. Il test di regressione usa ReadableStream con `duplex: 'half'` e ripete il controllo sul percorso Kinde. Nessuna API salute è pubblicata da questo incremento; consenso/ADK/sync/erasure e identità del proprietario restano gate per il cutover.


## CF-03 · decoupling controllo identità guest (17/11/2026, candidato v2.508.0)

L'attivazione guest legge l'oggetto di identità dal provider, non più direttamente da `firebase.auth`: il provider legacy passa lo stesso oggetto e mantiene la semantica originale, mentre quello Kinde potrà usare una sessione verificata e una generazione antireplay indipendente. I fence owner/guest/vault e i controlli dopo gli await restano invariati. Non sono ancora implementati il provider Cloudflare pubblico, la sincronizzazione né il porting dell'owner cloud: questo diff non significa sostituzione completa di Firebase.


## CF-03 · ingresso account Kinde in React, dati salute ancora negati (17/11/2026, candidato v2.506.0)

L'account entry React è ora candidato pubblico **identity-only** su `src/App.tsx` per visitatori non guest e senza identità Firebase: verifica la sessione Kinde, permette il login hosted e mantiene la scelta guest isolata anche quando il servizio Kinde è indisponibile/offline. Il fallimento di verifica Auth non autorizza il cloud. Non monta il consenso candidato e non inoltra alcuna chiamata D1 health/consent. Il legacy `AuthProvider` rimane operativo anche per guest/vecchi percorsi, quindi questa fase non autorizza la dichiarazione di rimozione Firebase. Occorre sostituire interamente il provider, il lifecycle owner/guest, i journal e i diritti prima del GO. Regressioni isolate verificano che il login Kinde non sblocchi la PWA; il browser reale e le sessioni esistenti richiedono collaudo dopo deploy.


## CF-03 · login reale verificato e logout applicativo isolato (17/11/2026)

Registrazione email/password con Kinde e letture ripetute `POST /api/auth/session` confermate dal proprietario: identità verificata ed epoca 1, consenso sanitario 0. Un nuovo logout D1 diagnostico verifica CSRF e successivo 401 prima di dichiarare la disconnessione; nessun purge, logout SSO o grant fitness. Il frontend React/Firebase non è migrato: consenso, ADK, journal, replica e diritti sono NO-GO per i nuovi account finché non integrati e collaudati.


## CF-03 · JWT code exchange e TTL non persistente (17/11/2026, v2.501.0 candidata)

L'owner ha ottenuto sulla v2.500.0 `503 phase=access-token-lifetime`. Il verifier ha già verificato firma/JWKS, issuer/audience, client, subject e scadenza, poi ha rifiutato perché `exp-iat>86400`; ciò non significa che il JWT fosse scaduto. Kinde [documenta un default di 24h, personalizzabile](https://docs.kinde.com/build/tokens/configure-tokens/). La configurazione reale del tenant non è stata riletta e non va indovinata.

Il codice candidato rimuove solo dalla **prova access JWT monouso dopo state D1 consumato + code/PKCE server-side** l'ulteriore tetto di durata previsto per credenziali API; l'access JWT non viene persistito, restituito o riutilizzato per l'autorizzazione sanitaria. Rimangono `jwtVerify` RS256/JWKS, issuer/audience, client/subject/grant, `iat` e `exp` validi, ID JWT firmato max 1h con nonce/emails verificate e sessione D1 autonoma con revoca. **Il verificatore API indipendente rimane max15min** e continua a rifiutare token dalla durata maggiore. Nuove regressioni attraversano vero flusso OAuth+SQLite current-schema, replay e login negativo su token scaduto e nonce/email errati.

Per il GO futuro verificare la configurazione token Kinde sul provider ed eventualmente riportare a un valore di sicurezza consigliato, senza cambiare password, token, Secret o DNS in questo incremento. Nessun dato salute, AuthContext, App Check o Vercel modificato. Il login reale resta da collaudare e la diagnostica temporanea da rimuovere prima del GO generale.


## CF-03 · delimitazione 503 `access-token` senza workaround (17/11/2026, candidato v2.500.0)

Un nuovo tentativo di login hosted Kinde sulla v2.499.0 è arrivato alla verifica dell'access token con `503 phase=access-token`, dopo lo state monouso e la token response. I percorsi `/__ /auth` Firebase, App Check e Vercel non sono chiamati da quella verifica e restano un problema separato di migrazione dell'AuthContext. La richiesta Kinde include già esplicitamente `audience` e `scope=openid email profile`. Non si può dedurre la causa del 503 dai test JWT sintetici né dal precedente `id-token` visto in un diverso tentativo.

Nel solo percorso di diagnostica autorizzato la verifica access JWT distingue fasi JOSE fisse (aud/iss, chiave, firma, expiry, alg) e fasi claim (client, subject, grant, timestamp, lifetime), senza divulgare valori o accettare nuovi token. Hardening: i token M2M con `gty: ["client_credentials"]`, formato documentato Kinde, devono essere rifiutati senza principal D1. Il service binding Kinde rimane l'unica API pubblica di login; `D1_API` health resta assente. Dopo le prove esatte del deploy, la singola prova browser deve restituire un codice `phase` oppure una sessione verificata: **NO-GO applicativo** fino al percorso completo. Eliminare le fasi temporanee dopo la correzione.


## CF-03 · callback Kinde: errore ID-token circoscritto (candidato v2.499.0, 17/11/2026)

Il nuovo collaudo v2.498.0 dell'owner restituisce `503` con `phase=id-token`: exchange OAuth e access-token proof sono stati superati, il JWT ID è stato rifiutato **dentro `jwtVerify`**. Non si presume un errore di audience senza prova: Kinde documenta esempi di `aud` differenti (dominio issuer o identificatore dell'app). Il backend non è autorizzato a fidarsi di un token o di un claim senza verifica crittografica del destinatario.

La patch espone una **sottocategoria temporanea non identificante** (audience, issuer, expiry, key, signature, algorithm; altri restano `id-token`) solo sulla risposta di errore 503 che segue uno state OAuth validato/consumato. Gli errori JOSE sono classificati mediante `code` ed eventualmente il nome fisso del claim `aud`/`iss`; mai messaggi, valori o token. Stessi requisiti RS256, issuer, audience, nonce, azp, emailVerified, sessioni D1 e `no-store`; nessun reset/rimozione di controlli. Test firmati e D1 simulano mismatch audience/issuer/expiry/kid/signature e verificano zero sessioni, replay negato, nulla loggato. **Nessuna conclusione su Auth live** senza un nuovo tentativo browser dopo gate exact-SHA e deploy del Worker Kinde. Togliere l'intera diagnostica prima del GO finale.


## CF-03 · localizzazione del 503 Kinde con diagnostica non identificante (candidato v2.498.0)

Al 17/11/2026, `main` v2.497.0 ha incorporato incrementi CF-05/07/08 indipendenti, ma la sessione Kinde reale fallisce ancora in callback (503). Il readback aggregato del D1 isolato Auth mostra zero owner e zero sessioni, senza provare il punto di fallimento. La configurazione del Worker Kinde non espone un log applicativo che separi il 503 di exchange/provider, JWT o write, e non è autorizzato collezionare token, errori Kinde raw, URL callback, o dati dell'utente.

Si introduce quindi un campo diagnostico **temporaneo** `phase` solo sulle risposte 503 dopo il consumo monouso di stato browser validato. I valori sono un insieme statico non identificante: `token-transport`, `token-response`, `identity-input`, `access-token`, `id-token`, `id-claims`, `token-binding`, `principal-storage`, `session`. Tutte le altre risposte, la validazione CSRF/PKCE, i token, le sessioni, il consenso e il funzionamento dell'API sanitaria sono invariati. Senza stato OAuth provato non viene fornita diagnosi; nessun evento è scritto in Cloudflare logs/D1 o al client per monitoraggio remoto.

Una singola prova manuale hosted su un **nuovo tentativo** dopo il deployment del Worker privato identifica il confine del guasto e consente una correzione fondata; i test di token sintetici, CI o smoke HTTP non sostituiscono il login reale. La rimozione della diagnostica è un gate per il rilascio funzionale finale.


## CF-05/08 — chiave fitness e autorità indipendente

Il candidato verifica il registro D1 indipendente prima del provisioning e dopo l'apertura della chiave richiesta da /v1/cloud-key/sync. In caso di revoca concorrente o registro chiuso, la risposta non contiene la chiave. L'eventuale chiave già emessa resta cifrata e riutilizzabile soltanto con una nuova autorizzazione. Restano aperti i collegamenti del consenso, della revoca, del percorso diritti e della finalizzazione al registro, oltre al collaudo su Cloudflare.

## CF-08 — candidatura gate di sync a prova di Time Travel (v2.497.0, 17/11/2026)

**Incremento CRITICAL sul Worker API isolato, non sul frontend Kinde.** Il database D1 indipendente già inizializzato (0001/0002) viene configurato come secondo binding `RECOVERY_DB` **solo** per `thelogbook-api-isolated`, distinto da `DB` e dal Worker AuthGate. Il manifest non aggiunge route, URL workers.dev/preview né bind al frontend. I validatori GitHub e di readback Cloudflare devono verificare esattamente l'UUID della seconda D1.

Tutte le route `/v1/sync/*` passano ora per `requireCurrentIndependentSyncFence` **prima di accedere al D1 applicativo e nuovamente prima di restituire una risposta di successo**, incluse ricevute, replay e reconciliations di ACK ambigui. L'helper ricontrolla la sessione non revocata, il principal, il consenso sanitario e l'epoch sulla prima D1 primaria, poi confronta lo stato e i floor con la seconda D1 primaria tramite `requireIndependentOwnerFence`. Registro assente, `sealed`, owner non registrato, stato `blocked`, quota o lettura non verificabile producono un rifiuto: mai ciphertext, nuova replica o ACK positivo. La richiesta già committata in app D1 prima di un blocco esterno resta **ambigua** al client; il journal durevole deve consentire il recupero senza dichiarare successo.

**Rischio residuo decisivo:** questo incremento NON collega ancora CF-08 al Worker di consenso, chiavi e cancellazione né al gate Auth condiviso. Il nuovo guard serve a impedire l'accesso sync nell'attuale Worker privato; i flussi di consenso/revoca dovranno registrare l'owner e armare il deny esterno **prima** del commit della revoca nella D1 principale, altrimenti l'architettura non è completa. La D1 registry è attualmente `sealed` senza owner: nessuna operazione reale di fitness può ottenere accesso. Non aprirla fino a protocolli cross-DB, consent, chiavi e runtime testati. I test SQLite riproducono sia deny prima del commit sia deny dopo un commit ma prima dell'ACK. Non esiste una transazione cross-D1: condizione di sicurezza da rivalidare prima di rendere pubblica l'API.



## CF-08 — Autorità monotona separata (incremento candidato v2.494.0, 16/11/2026)

La D1 isolata `thelogbook-cf08-fence-eu-isolated-20261116` è stata creata e riletta direttamente sul provider come **seconda** risorsa con `jurisdiction=eu`, senza read replication e senza collegamenti ai Worker o al sito pubblico. Creazione consentita nei limiti ufficiali del piano Free (https://developers.cloudflare.com/d1/platform/limits/ e https://developers.cloudflare.com/d1/platform/pricing/). **Nessun dato reale, fatturazione, DNS o binding Production modificato.** **Schema D1 applicato e verificato il 16/11/2026 dopo merge main v2.494.0 SHA `55676b255260b6d7fa5967941389883ad129f850`.** Sul target nuovo e isolato, dopo controllo dell'inventario e dell'unica tabella tecnica preesistente `_cf_KV`, è stata applicata tramite API Cloudflare la migration esatta `0001_independent_owner_fences.sql` e registrata in `d1_migrations` (nessun dato utente). Il readback provider ha attestato tabelle `recovery_control`, `recovery_owner_fences`, `d1_migrations` e cinque trigger; `mode=sealed`, `generation=1`, zero owner. Due tentativi di modifica non autorizzata (apertura senza progressione della generazione e inserimento diretto `active`) sono stati rifiutati HTTP 400; un nuovo readback ha confermato lo stato invariato. **È un bootstrap tramite API REST, non un'esecuzione di Wrangler né una prova di rollback o di migrazioni successive con Wrangler.** Prima della prossima migration verificare che Wrangler riconosca correttamente il ledger; preferire la procedura Wrangler con backup automatico. Il manifest `cloudflare/recovery/wrangler.isolated.jsonc` riguarda esclusivamente il database indipendente e non definisce alcun Worker o route pubblica.

`cloudflare/recovery/migrations/0001_independent_owner_fences.sql` è una migration **per il secondo database soltanto**, non per il D1 applicativo, con gate globale inizialmente `sealed`, enrollment `pending`, sequenza crescente, floor non regressivo e divieto SQL di resuscitare un owner `blocked/withdrawn/deleted` come `active`. La riaccettazione di consenso **non è ancora implementata**: introdurre una nuova generazione autorizzata richiederà un protocollo distinto. Non aprire il gate globale per usare questa prima migration in Production.

La migration candidata `0003_withdraw_pending_health_consent.sql` riguarda solo il D1 indipendente. Conserva le barriere precedenti e permette al Worker di bloccare direttamente una prima accettazione quando la D1 applicativa ha committato e il registro è ancora `pending`. Prima di aggiornare il Worker, verificare l'ordine e il ledger delle migrazioni in un ambiente isolato. Il test Node/SQLite non prova l'applicazione sul provider.

La migration candidata recovery `0004_health_erasure_cutoffs.sql` aggiunge
la barriera di export prima della finalizzazione nella D1 applicativa.
Il runner richiede entrambi i binding privati e riconcilia al massimo un
tentativo scaduto a ogni invocazione. Il census di ripristino si ferma
finché il registro ha una finalizzazione da riconciliare. Prima di una
prova provider applicare e verificare la migration sulla sola D1
indipendente autorizzata e mantenere isolati il runner e la chiave cloud.

`cloudflare/recovery/independent-owner-fence.mjs` è un adapter **non montato**: enrollment dopo verifica identità, attestazione del primo consenso dopo readback D1 primario, **deny esterno durevole PRIMA della revoca** sulla D1 applicativa, verifica della revoca con job, verifica terminale con prova SQL 0010 e floor esterno, più lettura per-request dall'autorità primaria separata. Errori, assenza del binding, stato `sealed` e mismatch negano l'accesso. Il codice deve essere integrato nei chiamanti veri di Auth, consenso, chiavi, sync, diritti ed erasure prima del GO; il solo helper non protegge il runtime. Il test normativo usa lo schema D1 applicativo completo, il vero runner di erasure, una seconda SQLite e il rollback fisico della prima: una vecchia sessione/consenso non basta a superare il floor esterno.

**Correzione necessaria dopo bootstrap 0001 (versione v2.495.0):** SQLite con `recursive_triggers=OFF` può eseguire `INSERT OR REPLACE` cancellando una riga in conflitto senza attivare il trigger `BEFORE DELETE`. La migration additiva `0002_block_replace_bypass.sql` blocca il tentativo con due trigger `BEFORE INSERT` su controllo globale e floor owner. Il codice di enrollment legge prima il registro e recupera l'esito di insert concorrenti solo tramite readback primario, senza più usare `ON CONFLICT DO NOTHING`. **La D1 isolata del provider, al checkpoint 0001, non ha ancora 0002: mantenerla `sealed` e senza owner fino all'applicazione/verifica separata.** Test SQLite includono `REPLACE` con recursive triggers disabilitati. La nuova migration non è un'autorizzazione a riaprire il gate.

**Rischi residui NO-GO:** la seconda D1 stessa può essere restaurata/manomessa da operatori con privilegi ampi; sono necessari IAM separati e divieto operativo di Time Travel simultaneo, inventario e copertura completa degli owner, manutenzione con accessi chiusi durante restore, provider restore/recovery su dati sintetici e quota/CPU, prova di fail-closed dopo errori cross-resource, protocolli di riaccettazione e delete account, collegamento dei gate e collaudi browser/Safari/prove reali di provider. Non esiste atomicità fra le due D1 e una lettura esterna non è una transazione con le scritture nel D1 applicativo. La seconda D1 non è un backup delle chiavi, né la sua giurisdizione garantisce il luogo di elaborazione di Workers/OAuth/log.


## CF-07 — Quota D1 e recupero ACK: regressioni v2.492.0

**Base verificata:** `main` v2.491.0 SHA `e9a0b7154b8d139815e7eb22818251640e395cb7`; PR #1184 riallineata senza riscrivere codice Kinde, CF-05 o CF-08. Due test Node esercitano il Worker reale `cloudflare/api/worker.mjs` con schema SQL D1 completo: un rifiuto quota sintetico non crea ciphertext, ricevute o ACK e il retry recupera; un commit persistito con risposta persa e lettura primaria indisponibile produce 503 (non successo inventato), poi riconcilia la ricevuta esatta e il replay è idempotente. Non cambia il runtime, solo le regressioni e questa nota.

**Limiti:** le fault injection SQLite non misurano quote/CPU, rate limiting o comportamento D1 Free reale, né sicurezza browser/offline. Nessun Cloudflare, Auth/Kinde, DB reale o segreto modificato da questo test. CF-07/CF-08 restano PARZIALI/NO-GO e la CI exact-SHA sul nuovo branch è una prova diversa da quella del vecchio candidato v2.489.0.



## CF-08 — Recupero D1 e rischio di resurrection (candidato v2.491.0)

**Baseline:** `main` v2.490.0 SHA `50a9d25227a8c40e36d8fecd91cf62bd7e23f30e`. Un ripristino D1 Time Travel **sovrascrive in-place il database**. Sul Workers Free la finestra è **7 giorni**; Cloudflare indica inoltre fino a 10 DB per account Free e 5 GB totali, senza che ciò autorizzi automaticamente una nuova risorsa (documentazione ufficiale: https://developers.cloudflare.com/d1/reference/time-travel/ e https://developers.cloudflare.com/d1/platform/limits/).

**Difetto strutturale riprodotto:** anche una prova di cancellazione `health_erasure_finalizations` immutabile, il floor `erased_before_revision` e il blocco SQL del consenso attivo risiedono nella *stessa* D1. Un ripristino a prima della revoca annulla anche la loro esistenza e rimette in vigore il consenso e la sessione originari. I trigger proteggono lo stato corrente, non la cronologia esterna a quel file. I test `cf08-restore-preflight.node.mjs` applicano tutte le migrazioni canoniche su SQLite sintetico, eseguono il **vero** runner di erasure, conservano un'immagine precedente e ne riproducono il rollback: il vero AuthGate torna ad autorizzare lo stato vecchio. Una seconda SQLite indipendente conserva il floor terminale e rende rilevabile la regressione. Nessun database Cloudflare è stato ripristinato.

**Primo incremento di codice:** `cloudflare/recovery/restore-preflight.mjs` è esclusivamente una funzione *diagnostica offline* che confronta una riga restaurata con un floor monotono fornito da una fonte indipendente. Provenienza mancante/illeggibile, owner diverso, generazione/epoch/floor inferiori o stato cancellato riattivato producono `blocked`. Anche `consistent-for-diagnostics-only` **non autorizza** riaprire l'app, né certifica la copertura di tutti gli owner, la firma o l'integrità della fonte. Il modulo **non è collegato agli endpoint pubblici**. Un secondo controllo puramente diagnostico, `inspectRestoredOwnerCoverage`, confronta l'insieme fornito di righe ripristinate con l'insieme fornito di floor esterni: blocca owner mancanti, aggiunti, duplicati, e mantiene i controlli di generazione per ciascun owner. **Non verifica** autenticità, monotonicità storica o completezza della lista esterna: due elenchi entrambi incompleti possono risultare coerenti. La prova di copertura autorevole e i fence runtime restano obbligatori prima di un restore.

### Architettura e gate ancora necessari prima di un vero restore

1. **Autorevolezza indipendente:** progettare un registro *monotono* fuori dalla D1 principale, con per-owner pseudonimizzazione appropriata, retention/GDPR, bootstrap verificato di *tutti* gli owner e checkpoint di copertura. La seconda D1 Cloudflare Free è una possibilità da valutare, non una risorsa esistente/approvata. Non usare KV eventualmente consistente come unico fence sanitario e non usare uno snapshot della medesima D1 come prova.
2. **Ordine degli aggiornamenti e crash:** registrare il deny esterno prima di poter considerare una revoca/erasure completata; un errore fra due DB separati deve lasciare l'utente *bloccato*, con riconciliazione idempotente e senza falso ACK. Anche il consenso iniziale, la riaccettazione e l'eliminazione account richiedono un protocollo di enrollment e generazioni anti-replay. La mancanza di transazioni SQL cross-DB vieta di attribuire atomicità implicita ai due writer.
3. **Gate in lettura sempre attivo:** sessione, consenso, cloud-key, sync e diritti devono consultare il limite esterno autorevole e negare la vecchia generazione **prima di qualsiasi accesso**. Nessun cache/pubblicazione può autorizzare dati vecchi durante o dopo restore. Dopo recovery serve riattestare integrità schema/chiavi, eseguire migrazioni e check owner/epoch per ogni record; non basta la diagnostica qui introdotta.
4. **Procedura operatore:** bloccare l'accesso prima dell'operazione, identificare in modo non ambiguo database/ambiente, snapshot e finestra, ottenere evidenza indipendente, eseguire il restore **solo in una risorsa isolata previa autorizzazione specifica**, audit completo, eventuale replay/fencing con proof, nuova verifica delle chiavi e test a due dispositivi. Un vecchio bookmark può ripristinare anche token di sessione e chiavi wrapped; i backup KEK e gli export devono essere separati. Senza questi gate: **NO-GO**, non eseguire restore sul database in uso.
5. **Verifiche residue:** test con owner non presente nel backup, stato cancellato, sessione scaduta, guest/offline, concorrenza tra replica e restore, perdita/corruzione KEK, contatore GDPR e retention, quota Free, restore reale sintetico D1 e RPO/RTO misurati. La simulazione SQLite non certifica la procedura Time Travel del provider né la ricostruzione selettiva per owner.


## CF-05 — Stato consenso dopo cancellazione terminale (candidato v2.490.0, 16/11/2026)

**Base di lavoro:** `main` v2.489.0 SHA `86e1bd4e3f64c2164f723b97b7e0ab31efe76d4c`; branch `fix/cf05-post-erasure-consent-status-20261116`. Il finalizzatore SQL 0010 aumenta la generazione del soggetto sanitario senza obbligare l'identity principal a cambiare epoch. Precedentemente `/v1/consent/status` rispondeva HTTP 503 a una sessione ancora valida dopo tale completamento, impedendo la lettura dello stato revocato. Il candidato introduce un'eccezione **solo consultiva**: la lettura `withdrawn` un'epoch avanti richiede sul D1 primario il job `complete` e la prova finale immutabile con floor esatto. Il client legge solo `consent-suspended`, senza riaprire fitness, vault, repliche o dati cancellati. Test Node/SQLite esercitano primo consenso, revoca, esecuzione del vero runner, finalizzazione, readback del Worker e divieto di sync; casi negativi coprono un epoch contraffatto senza prova e i falsi stati attivi/deleted lato client.

**Confine dell'evidenza:** questa è una regressione candidata, non un attivazione o test live di Kinde. Nessuna route pubblica, secret, D1 remoto, cron o record reale è modificato. La risposta di stato non è prova sufficiente di anti-resurrection dopo restore; CF-08 resta NO-GO. Il client PWA attivo usa ancora il percorso legacy e restano necessari collaudi integrati di revoca, esportazione diritti e recupero, nonché gate CI/CodeQL exact-SHA e runtime Cloudflare.


## CF-03 — compatibilità della durata dei token nella callback Kinde (candidato v2.489.0)

Il collaudo browser ha dimostrato che la callback reale ora raggiunge il backend oltre il precedente rifiuto del parametro `scope`, ma ritorna **503**. Il percorso di errore aggrega fallimenti di exchange, JWKS, verifica claim, D1 e session issuer, quindi la causa specifica **non è osservata**. È stata però riscontrata una difformità riproducibile fra la policy locale dei token sintetici (access max 15 min) e la durata predefinita documentata dal provider Kinde (access 24h, ID 1h: https://docs.kinde.com/build/tokens/configure-tokens/). Il tenant Kinde potrebbe avere una scadenza personalizzata, non ancora verificata.

Il candidato separa **due boundary**: l'API token verifier rimane limitato a 15 minuti; il token JWT ottenuto esclusivamente tramite callback server code+PKCE monouso può avere fino a 24h di scadenza in fase di **prova immediata**, legata a ID token (max 1h), nonce, email verificata e firme/issuer/audience/client ID. I token non attraversano il browser e non conferiscono diritti fitness autonomi. La sessione applicativa ha una propria durata e il proprio controllo di revoca in D1. Test di regressione real-shaped e valore Kinde default 86400 su JWT, D1 e replay; negazione di token alterati e di usi API long-lived.

Il prossimo collaudo deve partire da un **nuovo login** dopo la distribuzione verificata del Worker privato; la CI verde non equivale alla riuscita del codice OAuth reale, e non autorizza l'attivazione dell'API dati sanitari.


**Deploy effettivo del fix OAuth:** il workflow `Cloudflare Kinde HTTP Worker (private, main-only)` in passato partiva automaticamente soltanto dopo modifiche al suo YAML; quindi il merge del parser non garantiva il deploy del Worker privato, mentre il normale workflow Cloudflare Static Assets pubblica il solo frontend. Per prevenire un runtime privato obsoleto, il candidato attiva il workflow private Kinde anche per modifiche a `cloudflare/auth/**` e `cloudflare/api/logout-worker.mjs`, lasciando invariati la restrizione a `main`, la verifica CI trusted exact-SHA e l'isolamento `workers.dev`/preview. Dopo il merge serve leggere **versione effettiva e ultimo deployment del Worker Kinde**, oltre ai gate post-merge e allo smoke frontend. Un deploy verde di Static Assets da solo non certifica il nuovo parser OAuth.


## CF-03 — compatibilità callback Kinde con scope nel redirect (candidato 16/11/2026)

Il primo percorso live di registrazione ha raggiunto il provider Kinde ed eseguito la verifica email e la regola password 15+, ma il ritorno `GET /api/auth/kinde/callback` è fallito con HTTP 400. Il parser OAuth accettava esclusivamente `code`/`state`/`error`/`error_description`, mentre Kinde ha inviato anche `scope`, comportamento documentato dal provider. Causa immediata verificata sul codice; altre cause concorrenti non ancora escluse perché il parser si fermava prima della validazione state/cookie e dello scambio dei token.

La patch autorizza l'eventuale `scope` **solo se equivalente all'insieme esatto richiesto** `openid email profile`, senza ammettere parametri aggiuntivi o bypass di CSRF/PKCE, replay/nonce, verifica JWT o limite di durata. Suite Node/SQLite ed HTTP gateway coprono callback di forma reale, eventuale scope assente, scope alterato/duplicato e state non consumato prematuramente. **Resta NO-GO l'autenticazione end-to-end finché non si osserva un nuovo percorso browser dopo i gate GitHub e lo smoke Cloudflare.** Non usare o registrare codici OAuth o stati del tentativo fallito.


## CF-03 — collaudo browser Kinde con diagnostica strettamente isolata (candidato v2.486.0)

Per poter collaudare login email/password, Google, verifica email e callback reali senza collegare prematuramente `AuthContext` Firebase o API salute D1, il candidato introduce un documento standalone `/verifica-accesso`, non linkato dal sito ordinario. Il suo form invia `POST /api/auth/kinde/start` senza payload; un'azione esplicita separata legge `POST /api/auth/session` nello stesso browser. Lato client non tratta password, ID token o dati fitness, non persiste nulla e non stampa UID. Il risultato positivo segnala solo una sessione server Kinde email-verificata; mai consenso, cloud key o diritto a salvare dati salute. Noindex, no-store, asset smoke byte-exact e service-worker denylist sono obbligatori.

L'incremento è **solo uno strumento di test**, non costituisce un login completo della PWA. Il provider Kinde non offre un grant password senza interazione (vedi [guida Kinde](https://docs.kinde.com/authenticate/about-auth/kinde-authentication-faq/)); registrazione, reset, email verification e Google richiedono azione browser e verifica del relativo esito. Non esporre token/codici nei log o simulare una login Production tramite fixture; usare account di prova su D1 sintetica isolata. Le quattro route OAuth esistenti e l'isolamento di `/v1/*` non cambiano.


## CF-03 — gateway OAuth-only pubblico, backend sanitario ancora isolato (16/11/2026)

**Codice e gate:** [PR #1175](https://github.com/gernotfound/logbook/pull/1175) integrata su `main` v2.484.0 SHA `dd93ad16fa47f795f1690a31cec4e20c146f29e6`. [CI PR](https://github.com/gernotfound/logbook/actions/runs/43873755312), [Main/CodeQL](https://github.com/gernotfound/logbook/actions/runs/43879661972), [Firestore](https://github.com/gernotfound/logbook/actions/runs/43880098527), [Worker privati](https://github.com/gernotfound/logbook/actions/runs/43879661927) e [Cloudflare Static Assets + smoke fail-closed](https://github.com/gernotfound/logbook/actions/runs/43880148635) tutti SUCCESS per la versione pertinente. Quattro route esatte `/api/auth/kinde/start`, `/api/auth/kinde/callback`, `/api/auth/session`, `/api/auth/logout` esposte su `thelogbook.me` tramite unico service binding `KINDE_HTTP`. Nessuna route sanitaria `/v1/*` né binding `D1_API` sul frontend; helper Firebase mantenuti fino alla migrazione verificata.

**Readback Cloudflare:** frontend versione `2b19b304-f82f-44e4-b751-5edd1831b661` distribuita al 100% con `ASSETS`, `APP_ORIGIN`, `KINDE_HTTP`; Worker Kinde privato versione `c2eb32a4-cbc7-478c-9ba9-5f556a17621f` 100%, con DB D1 sintetica, `AUTH_GATE`, rate limiter e **5/5 Secret OAuth** `secret_text`. Worker privato senza ingressi workers.dev/preview o Custom Domain; i valori delle credenziali non sono stati letti.

**Readback Kinde in sola lettura:** nel pannello `TheLogBook → Details` la callback `https://thelogbook.me/api/auth/kinde/callback` corrisponde al codice, homepage `https://thelogbook.me/`, login URI e logout redirects vuoti. Il logout implementato è solo sessione applicativa. Audience di access e ID token **non collaudate tramite token reali**, policy password 15 caratteri (iniziale/reset) `Live` secondo la schermata owner ma non testata nel runtime. Non sbloccare AuthContext Kinde, consenso, chiavi/ADK, sync o diritti/erasure sulla sola attestazione di configurazione/deploy.

**Stato CF-03:** gateway HTTP OAuth-only pubblicato e smoke completato; **intero login Kinde e migrazione Cloudflare ancora PARZIALI / NO-GO funzionale**. Per proseguire: test OAuth Kinde email/Google con identità sintetiche, verifica email/nonce/CSRF/PKCE e claims, policy password e recovery, poi integrazione client e API sanitarie dietro gate completi. Il cutover PWA richiede collaudo browser, cifratura, consenso, isolamento, offline e cancellazione.

---

## CF-04/CF-09 — Journal D1 e smoke Static Assets (16/11/2026)

**GitHub `main` v2.482.0 `5f02f88a59f07ad1ba585c0263fc7fd665cd2a6e`:** la [PR #1176](https://github.com/gernotfound/logbook/pull/1176) ha integrato il risequenziamento atomico delle sequenze causali D1 oltre otto documenti, protezione del journal cifrato in caso di errore 503 e fencing degli intenti concorrenti claim/retirement. [CI candidato #43866294737](https://github.com/gernotfound/logbook/actions/runs/43866294737) e [gate main #43868884368](https://github.com/gernotfound/logbook/actions/runs/43868884368) **SUCCESS**. Firestore reconciliation [#43869286467](https://github.com/gernotfound/logbook/actions/runs/43869286467) SUCCESS, con deploy Rules/indici skipped. **CF-04 resta PARZIALE**: la replica D1 non è ancora collegata alla PWA Kinde, né sono provati HTTP Auth/ADK, primo claim, hydration, lost ACK, secondo dispositivo e offline reale.

**Anomalia CF-09 confermata:** il deploy Workers Static Assets è riuscito su `main` v2.481.0 e v2.482.0, ma gli smoke [#43866124393](https://github.com/gernotfound/logbook/actions/runs/43866124393) e [#43869344824](https://github.com/gernotfound/logbook/actions/runs/43869344824) sono **FAILURE**: HTML/SW/manifest corrispondono al build dopo propagazione bounded, poi una richiesta a chunk JS/CSS riceve HTTP 404. Il workflow verificava i chunk **una sola volta** subito dopo il deploy, senza riportare quale file mancasse. Cloudflare documenta il *version skew* tra HTML e asset durante la propagazione dei deployment: è una causa plausibile, non una diagnosi runtime definitiva. La correzione candidata CF-09 introduce retry temporizzati anche per i chunk, accettando solo HTTP 200, MIME corretto e byte identici al build e fallendo con diagnostica del file specifico dopo il limite. **Non dichiararla validata o distribuita finché CI e smoke nuovo main non siano verdi.** Nessuna route/API/secret Kinde, Auth o D1 viene modificata.

La [PR Kinde #1175](https://github.com/gernotfound/logbook/pull/1175) resta di competenza separata. Non dedurre GO funzionale o disponibilità PWA da questi incrementi. Le issue [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058) e [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063) registrano gli esiti per fase.


## CF-03 — Worker Kinde HTTP privato distribuito e verificato (16/11/2026)

**Completato soltanto il deploy privato autorizzato:** `main` v2.479.0 SHA `44c294bf69261c31e37c2cdb3f78432941ae6aba` dopo [PR #1173](https://github.com/gernotfound/logbook/pull/1173), CI candidata [#43830350700](https://github.com/gernotfound/logbook/actions/runs/43830350700), gate main [#43830734390](https://github.com/gernotfound/logbook/actions/runs/43830734390) e workflow deploy [#43830734570](https://github.com/gernotfound/logbook/actions/runs/43830734570), tutti SUCCESS. Il readback diretto Cloudflare conferma `thelogbook-cf03-kinde-http-isolated` al 100% (version ID `593d695d-b9f3-44b3-bf4b-422074ff1e01`, 08:25:57 UTC) con solo `DB` alla D1 EU sintetica approvata, `AUTH_GATE`, `AUTH_RATE_LIMITER` e `APP_ORIGIN`. `workers.dev`, preview, route zona `thelogbook.me` e custom domains **assenti/disabilitati**. Nessun segreto Kinde aggiunto, nessuna migrazione D1, nessun ingress OAuth/fitness esposto, nessuna scrittura su account reali.

**Resta PARZIALE / NO-GO funzionale:** `AuthContext` browser è Firebase, il Worker privato non è raggiungibile dal browser, il tenant Kinde e la password >=15 nel reset non sono collaudati, segreti Kinde/KEK e callback non attivati; mancano consenso, salvataggio cifrato, sync/journal/ACK, diritti, browser e rate abuse test reali. Il `Main Release Gate`, il deploy Kinde e il readback provider certificano ciascuno solo il proprio perimetro.

**Classificazione: CRITICAL · stato PARZIALE / NO-GO funzionale (dominio pubblico di sviluppo autorizzato).** La fonte di verità per il codice e i test è `main` GitHub; per risorse e runtime sono i rispettivi provider. Questo documento descrive **contratti correnti e blocchi**, non lo storico di commit. [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053) · [registro servizi](external-services-register.md) · [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063).


## Ricognizione del 16/11/2026 — baseline GitHub v2.474.0

**GitHub:** `main` `519f80c077b8ca40e8f3630ea4f110ffb342e012` (`2.474.0`). La [PR #1168](https://github.com/gernotfound/logbook/pull/1168) ha aggiornato documentazione e versione, **senza attivare il percorso Kinde/D1**. Riletti direttamente i workflow [Main Release Gate/CodeQL #43771473060](https://github.com/gernotfound/logbook/actions/runs/43771473060), [Firestore #43771679958](https://github.com/gernotfound/logbook/actions/runs/43771679958) e [Static Assets/smoke #43771707785](https://github.com/gernotfound/logbook/actions/runs/43771707785): tutti `success` per il medesimo SHA. I gate non equivalgono a prove di login, sincronizzazione o erasure.

**Cloudflare (readback 16/11, sola lettura):** Worker `thelogbook-frontend` attivo, con solo binding `ASSETS`; `thelogbook-api-isolated` conserva il binding `DB` alla D1 sintetica EU e il service binding `AUTH_GATE` verso `thelogbook-cf03-auth-gate-isolated`; quest'ultimo ha `DB` e rate limiter. Su tutti e tre i Worker `workers.dev` e preview sono disabilitati, con deployment al 100% delle rispettive versioni. La D1 `thelogbook-cf02-eu-isolated-20261113` espone `jurisdiction=eu`; **in questa ricognizione non sono stati interrogati schema, ledger SQL, dati o query runtime**. Il Worker `thelogbook-cf03-kinde-http-isolated` non compare nell'inventario degli script distribuiti. Non sono stati letti né modificati valori di secret.

**Conseguenza:** il confine HTTP Kinde non è distribuito; il frontend resta statico e l'applicazione pubblica non è ancora passata ad Auth/consenso/chiavi/Sync Workers+D1. **CF-03/04/05 e CF-09 restano PARZIALI / NO-GO funzionale.** Per un GO servono ancora validazione del provider Kinde (incluso minimo 15 caratteri nel reset), callback, secret e KEK, integrazione client, test autenticati con fixture isolate, quote/abuso, privacy e recovery. Non distribuire su Production API sanitarie o eseguire cambi DNS/OAuth/posta/billing per il solo fatto che questa nota è stata aggiornata.

## Checkpoint storico — v2.473.0, 15/11/2026

**GitHub `main` verificata:** `2702a5898004451028201d872112e58a5a800ab0`, v2.473.0. Il precedente checkpoint v2.464.0 riportato sotto è storico, non il codice corrente.

**Incrementi già integrati:** [#1164](https://github.com/gernotfound/logbook/pull/1164) (lettura D1 bounded e timeout, v2.470.0), [#1165](https://github.com/gernotfound/logbook/pull/1165) (logout sessione D1 solo dopo prova trusted, v2.471.0), [#1166](https://github.com/gernotfound/logbook/pull/1166) (composizione candidata sessione Kinde/consenso/ADK/journal D1, v2.472.0), [#1167](https://github.com/gernotfound/logbook/pull/1167) (primo consenso esplicito Kinde/D1 con nuova prova server, v2.473.0). Le due ultime PR hanno CI exact-SHA [#43769436716](https://github.com/gernotfound/logbook/actions/runs/43769436716) e [#43770249310](https://github.com/gernotfound/logbook/actions/runs/43770249310) **SUCCESS**, inclusi CodeQL, Chromium e WebKit. Il codice è un candidato senza route pubbliche e non costituisce un'integrazione AuthContext completa.

**Prove distinte v2.473.0:** [Main Release Gate/CodeQL #43770520566](https://github.com/gernotfound/logbook/actions/runs/43770520566), [Firestore #43770738175](https://github.com/gernotfound/logbook/actions/runs/43770738175) e [Cloudflare Static Assets/smoke #43770785236](https://github.com/gernotfound/logbook/actions/runs/43770785236) **SUCCESS** sullo SHA del merge. Il readback Cloudflare successivo mostra solo il binding `ASSETS` sul frontend, i Worker `thelogbook-api-isolated` e `thelogbook-cf03-auth-gate-isolated` ancora privati, **nessun Worker HTTP Kinde pubblicato**, e D1 isolata con `jurisdiction=eu`. Nessuna modifica ai secret/tenant Kinde né attivazione di API salute. La riconciliazione Firestore non dimostra la dismissione Firebase.

**Blocco di release:** `AuthContext`, il consenso attivo e i chiamanti cloud della PWA usano ancora Firebase. Prima di abilitare l'accesso Kinde su `thelogbook.me` occorre validare sul provider la password ≥15 caratteri anche nel reset, verifica email/Google/OAuth/callback, i binding e la custodia KEK, poi completare il client guest→account, consenso, archivio, replica, recupero, diritti e prove live Kinde/D1 con dati sintetici. CI e smoke degli asset **non** valgono come GO login/Sync/erasure. Nessun cambio DNS, OAuth Production, billing, dato reale o dismissione è autorizzato da questo checkpoint. L'audit prestazionale approfondito resta nel [POST-CF #1123](https://github.com/gernotfound/logbook/issues/1123); la sicurezza minima delle quote resta gate pre-GO.

## Checkpoint storico — 15/11/2026 (baseline v2.464.0)

**Checkpoint storico del 15/11/2026 (v2.464.0):** baseline, CI e readback originali conservati nel [registro servizi esterni](external-services-register.md). Gli esiti datati non costituiscono GO.





### Requisito password Kinde ≥15 — blocco provider (15/11/2026)

**Policy password Kinde:** requisiti, workflow e verifiche ancora applicabili sono mantenuti nella [guida Kinde](kinde-auth-setup.md).

### CF-03/05 — collaudo verticale sintetico del gateway (16/11/2026)

La suite `tests/cloudflare/cf03-kinde-http-worker.node.mjs` esercita anche il nuovo gateway come ingresso browser-like davanti ai **moduli Worker reali** Kinde HTTP, Auth Gate, consenso, chiave cloud e API D1. Usa solamente JWT firmati con chiavi sintetiche e SQLite in memoria con tutte le dieci migrazioni: OAuth start/callback con PKCE/nonce, sessione, primo consenso esplicito, rifiuto replica senza ADK, rilascio ADK, registrazione replica, revoca con blocco sync e logout. Le prove negative non devono creare consenso o replica in caso di CSRF errato. Questo percorso verifica la composizione del codice, non la configurazione Kinde o la distribuzione HTTP Cloudflare reale.

**Ancora NO-GO:** routing non montato su `thelogbook.me`, Worker HTTP Kinde e secret/KEK non attivati, `AuthContext` ancora Firebase, nessuna prova reale con account, email/Google, Safari, quote, storage durable o erasure completa. La suite isolata non autorizza ACK del client né sostituisce E2E sul provider.

### CF-03/04 — routing HTTP same-origin candidato, non attivo (16/11/2026)

`cloudflare/first-party-api-candidate.mjs` prepara un gateway di Service bindings fra frontend e Worker privati Kinde (`KINDE_HTTP`) / D1 (`D1_API`). L'allowlist esplicita copre esclusivamente le route Kinde/sessione, consenso, cloud key e Sync già definite dai rispettivi backend; tutte le altre richieste restano 404 e **non** tornano alla shell SPA. Il gateway richiede per i POST Origin e Fetch-Site compatibili con lo stesso sito, preserva la callback OAuth GET cross-site con state/cookie verificati dal Worker Kinde, propaga CSRF e cookie senza inserire Authorization o header di routing client come attestazioni, non segue redirect e rifiuta risposte prive di `no-store`. Il body di Sync resta verificato anche dal Worker privato. La suite `tests/cloudflare/cf03-first-party-api-candidate.node.mjs` verifica routing positivo/negativo, mancati binding, risposta ambigua, CSRF/cookie, limiti e redirect senza provider reali.

**Non è montato in `auth-proxy.mjs`, né aggiunto al `run_worker_first` o ai binding distribuiti su `thelogbook.me`.** Non è stato creato un endpoint Kinde pubblico, attivato un tenant o modificata D1. La scelta di abilitare i Service bindings verso i Worker richiede prima di tutto gli specifici gate e l'autorizzazione Production esposti sopra. Questo incremento è un prerequisito verificabile, **non un GO Auth/consenso/Sync o un collaudo end-to-end**.

### Gate prima di attivazione e collaudo Cloudflare/Kinde

1. **Confine HTTP ed identità:** predisporre routing deliberato e limitato al Kinde HTTP Worker per `POST /api/auth/kinde/start`, `GET /api/auth/kinde/callback`, `POST /api/auth/session` e `POST /api/auth/logout`, con binding privati e verifiche contro open redirect, replay, CSRF, sessioni scadute e rate limit. Il solo `auth-proxy.mjs` attuale intercetta `/__/auth/` per Firebase; non instrada queste route. Un codice candidato privo di route non è un sito autentificabile.
2. **Provider Kinde reale:** rileggere l'applicazione Back-end web, issuer, client ID, callback/logout registrati e metodi Password + Google; verificare policy minima **15 caratteri**, email verificata/reset, trust e unicità dell'owner. Il codice costruisce **esattamente** `https://thelogbook.me/api/auth/kinde/callback`; non sostituirlo con `/auth/callback` per analogia. La callback Google→Kinde `https://thelogbook.kinde.com/login/callback` è un flusso diverso. Senza accesso amministrativo Kinde non affermare che la callback sia configurata.
3. **Configurazione sicura server:** predisporre i binding necessari, incluso servizio privato Auth Gate, D1, limiter, client secret e KEK **solo come secret server-side**; verificare che la custodia ADK sia isolata dal vault device e che non vi siano dati salute in chiaro lato server. Non collegare un database di prova a dati reali né introdurre costi.
4. **App e recovery:** sostituire realmente `AuthContext`/azioni Firebase con l'identità Kinde, preservando guest puramente locale, consenso salute 18+, journal IndexedDB prima della rete, ADK separata, isolamento A→B→A, sessione e revoca, import/export, cancellazione e update PWA. Adapter e fixture attuali non sostituiscono questa integrazione.
5. **Prove verticali in sequenza:** test sintetici/CI exact-SHA e isolamento Worker; poi test controllati su provider con sole identità/dati sintetici autorizzati; verifica password, Google, verifica/reset, sessioni e cookie, consenso, cifratura, commit/ACK, offline/retry, diritti e cancellazione, Safari/iOS e quota CPU/D1. Ogni prova fallita o incerta deve essere NO-GO e non deve eliminare dati locali.
6. **Autorizzazioni separate:** mutazioni dell'app Kinde/Google OAuth Production, configurazioni segreti/IAM Production, esposizione di route che trattano dati sanitari, DNS e GO pubblico finale richiedono il mandato specifico del product owner previsto da AGENTS. I deploy automatici del solo frontend autorizzato non estendono tale mandato.

**Stato:** PARZIALE / NO-GO funzionale. L'audit approfondito delle prestazioni resta deliberatamente post-migrazione [#1123](https://github.com/gernotfound/logbook/issues/1123), senza rinunciare ai controlli minimi di quota e sicurezza necessari prima del GO.

### Preflight Kinde HTTP senza attivazione (incremento CF-03)

`cloudflare/auth/wrangler.kinde.isolated.jsonc` è una configurazione **candidata**, non una nuova risorsa dichiarata attiva: Worker `thelogbook-cf03-kinde-http-isolated`, `workers_dev=false`, preview disabilitate, D1 EU isolata, `AUTH_GATE` privato e limiter OAuth. La configurazione contiene solo `APP_ORIGIN` come variabile pubblica; issuer, client ID, audience, client secret e KEK devono essere verificati e configurati esclusivamente sul server dopo autorizzazione specifica. Non esistono route Kinde nel frontend. Il controllo `validateIsolatedKindeCandidate()` rifiuta esposizione di route, alterazione DB/Auth Gate, segreti in `vars` o attivazione anticipata del frontend; test Node e compilazione Wrangler `--dry-run` sono integrati nel gate privato. **Il dry-run non effettua deployment né collaudo OAuth reale.** L'eventuale nuovo Worker Kinde richiede una pipeline di deploy separata, binding verificati, test e GO.

## CF-03/04 — precondizione ADK e lettura candidata Kinde (15/11/2026)

La verifica **retrospettiva** della PR #1139 (annotata nella sua
conversazione GitHub) ha rilevato che gli assert `status != 200`
non distinguevano un ADK assente da un guasto transitorio. Non è una
review formalmente indipendente precedente al merge.
Nuovo contratto candidato: HTTP `428 cloud-key-required` soltanto
dopo prova D1 primary che chiave e marker mancano, revisione zero e
nessun documento cifrato, replica, receipt, mutation o erasure pendente,
con sessione/consenso tuttora validi;
`503` per guasti o stato chiave incoerente. Il client mantiene il
journal e il claim sigillato senza rebase automatico né ACK.
L'adapter read-only Kinde→consenso→controllo replica ricontrolla
UID/epoch/generazione dopo I/O **e richiede l'UID autenticato sulla
risposta stessa del controllo D1**. Questo blocca un cambio A→B→A
anche quando A e B condividono epoch e revisioni; un risultato senza
UID è rifiutato. Non abilita login reale, vault o Sync pubblici. OAuth/posta Production, KEK e dati reali restano NO-GO.
Una review indipendente degli incrementi CRITICAL è raccomandabile quando aggiunge una verifica utile, ma **non è obbligatoria per default**. Se effettuata, registrarne lo SHA esatto e non dedurla dalla CI; le approvazioni sono obbligatorie solo quando richieste dal ruleset GitHub o dal mandato esplicito. Il gate CI, le prove di sicurezza e i collaudi provider restano distinti.

## Regressione CF-03/05 full-schema integrata (15/11/2026)

**Root cause identificata nel codice:** due test di integrazione
`cf03-kinde-http-worker.node.mjs` e
`cf05-cloud-key-http.node.mjs` applicavano ancora soltanto
`0001`–`0008`, sebbene il D1 isolato usi `0001`–`0010`.
La fixture precedente poteva ammettere una registrazione replica
dopo il solo consenso, senza mai esercitare il guard `0009` sulla
chiave cloud effettivamente custodita.

**Correzione integrata con [PR #1139](https://github.com/gernotfound/logbook/pull/1139):** fixture SQLite con tutte le dieci migrazioni,
test di rifiuto della replica prima dell'ADK e nessuna mutazione
SQL/ACK, rilascio chiave tramite percorso HTTP trusted, successiva
registrazione riuscita, separazione dei due proprietari e revoca
che rimuove il grant SQL preservando rights-export. Gli altri
test storici che verificano deliberatamente una specifica versione
di migrazione restano separati e non vengono riscritti come
baseline corrente. Sono regressioni di integrazione **sintetiche**,
non attestazioni del provider Kinde o del runtime Worker reale.
La precisione del contratto HTTP e i fence concorrenti sono ulteriori
interventi nella PR #1141, ancora non integrata; le altre otto suite
runtime sono oggetto della PR #1154.

## D1 isolata aggiornata — 10/10 migrazioni verificate (15/11/2026)

**Prova GitHub:** [workflow manuale #43702489692](https://github.com/gernotfound/logbook/actions/runs/43702489692)
**SUCCESS** su `main 5ca7afaca94e4431e298595eecdd2a023546fd21`
(v2.446.0). Il job ha verificato il target e il gate release,
poi Wrangler ha applicato `0009_require_cloud_key_for_replica_writes.sql`
e `0010_atomic_health_erasure_finalization.sql` e ha superato il
readback finale.

**Prova indipendente Cloudflare:** D1
`thelogbook-cf02-eu-isolated-20261113` (UUID
`9aa51833-8adc-495f-bdfc-93b5542e8023`), `jurisdiction=eu`,
repliche disabilitate, bookmark Time Travel disponibile.
Il ledger contiene **tutte e dieci** le migrazioni ordinate
`0001`–`0010`. Sono presenti la view
`sync_writable_cloud_key`, la tabella
`health_erasure_finalizations`, i trigger
`sync_receipt_requires_cloud_key`,
`health_erasure_finalization_fence` e
`health_erasure_finalize_atomically`, e i nuovi campi per
la finalizzazione dell'erasure su subject/job. Zero principal
Auth, sessioni, ADK cloud e job erasure; il documento cifrato e la
ricevuta **sintetici** preesistenti (uno ciascuno) sono conservati.

**Risultato limitato:** schema della sola D1 EU sintetica **COMPLETATO**;
il token dedicato `CLOUDFLARE_D1_API_TOKEN` è stato effettivamente
utilizzabile dal job, ma non è stata ispezionata la policy IAM completa,
né la scadenza/revoca. Nessuna migrazione di account/dati Firebase.
La disponibilità del bookmark non dimostra un restore provato:
restano da validare backup/restore, Auth Kinde, consenso,
KEK/cloud keys, sincronizzazione/ACK, erasure end-to-end,
quote/abuso e iOS/Safari. **NO-GO funzionale**, API Auth/Sync
pubbliche ancora escluse. Non ripetere la migration per attivare
funzioni estranee allo schema.

## Checkpoint storico credenziali D1 prima dell'esecuzione — 15/11/2026

**Nuova evidenza dichiarata dal proprietario:** creato su Cloudflare un token API
separato dedicato alle migrazioni D1 e aggiunto su GitHub Actions come repository
secret `CLOUDFLARE_D1_API_TOKEN`. L'utente ha confermato entrambe le operazioni
in chat il 15/11/2026, **senza condividere il valore del segreto**. La
presenza/accessibilità del secret al job, l'esatta policy IAM (D1 Edit,
account target, scadenza), e la variabile Actions `CLOUDFLARE_ACCOUNT_ID`
**non sono state verificate da letture indipendenti**: la conferma utente
non sostituisce un preflight del workflow.

**Readback provider indipendente, 15/11/2026:** la D1 isolata
`thelogbook-cf02-eu-isolated-20261113` è ancora in giurisdizione `eu`,
repliche disabilitate e ledger `0001`–`0008` (**8/10**). Su GitHub non
risulta ancora alcuna esecuzione del workflow manuale di migrazione.
Quindi `0009`/`0010` **non sono applicate** e nessun GO funzionale è
implicito nella creazione della credenziale.

**Prossimo gate:** verificare su GitHub che il secret esista e che
`CLOUDFLARE_ACCOUNT_ID` punti all'account atteso, poi avviare **solo su
`main`**, con autorizzazione operativa, il workflow
[`Cloudflare isolated D1 migrations`](../../.github/workflows/cloudflare-d1-isolated-migrations.yml).
Il job deve verificare exact-SHA/gate di release, token e D1 target in
preflight, applicare con Wrangler le migration autorizzate e attestare
ledger/oggetti SQL post-scrittura. In caso di errore non ripetere alla cieca;
registrare run SHA ed esito provider prima di procedere. Né questo
checkpoint né il secret autorizzano attivazione di API pubbliche, login Kinde,
dati salute reali, DNS o cancellazioni.

## B-04 — checkpoint storico precedente alla migrazione D1 (15/11/2026)

**Evidenza live successiva a `main 53f8a5562d9952c3f70c0175ee212f88e7f92d6b` (v2.445.0):**
readback Cloudflare in sola lettura sulla **sola** D1 sintetica
`thelogbook-cf02-eu-isolated-20261113`. Identità database e UUID
corrispondono a `cloudflare/api/wrangler.isolated.jsonc`;
`jurisdiction=eu`, repliche disattivate, bookmark Time Travel disponibile.
Il ledger è esattamente `0001`–`0008` (8/10), gli oggetti introdotti
da `0009`/`0010` sono assenti, principal Auth/sessioni/ADK/job di
cancellazione sono zero. Restano una riga documento e una ricevuta
**sintetiche**, da preservare. Nessuna migrazione remota è stata eseguita;
la lista GitHub dei run `workflow_dispatch` non contiene un run D1.

**Blocco esterno per l'esecuzione:** il workflow
[`cloudflare-d1-isolated-migrations.yml`](../../.github/workflows/cloudflare-d1-isolated-migrations.yml)
è già integrato, con guard exact-`main`, verifiche preflight in sola lettura,
migrazione via Wrangler ufficiale (backup/rollback), controllo post-migrazione
e test CI sul candidato. Serve il secret GitHub **dedicato**
`CLOUDFLARE_D1_API_TOKEN`; il connettore GitHub disponibile in questa
sessione non consente di creare secret né di avviare il `workflow_dispatch`.
Non aggirare il workflow eseguendo SQL/mutazioni dirette sulla D1 o riusando/
ampliando il token Worker. L'assenza del secret non è verificabile tramite
l'interfaccia del connettore: deve controllarla il proprietario su GitHub.

**Passaggio manuale minimo del proprietario (senza condividere il token):**

1. Cloudflare dashboard → account TheLogBook → **Manage Account → API Tokens**
   (oppure **My Profile → API Tokens**) → **Create Token → Custom token**.
   Concedere solo **Account → D1 → Edit** sull'account Cloudflare pertinente,
   senza Workers/DNS/altre permission, limitando durata e risorse dove
   consentito dalla UI. La policy D1 è di ambito account: non presumere
   isolamento del token a un singolo database.
2. GitHub repository `gernotfound/logbook` → **Settings → Secrets and
   variables → Actions → Secrets → New repository secret**. Nome esatto
   `CLOUDFLARE_D1_API_TOKEN`, valore uguale al token appena creato.
   Controllare inoltre che la variabile Actions `CLOUDFLARE_ACCOUNT_ID`
   sia valorizzata per l'account corretto. Mai pubblicare il valore in
   issue, chat, commit o log.
3. GitHub → **Actions → Cloudflare isolated D1 migrations (manual,
   main-only) → Run workflow**, selezionando **main**. Dopo il gate
   exact-SHA, il job applicherà solo i file consentiti `0009`/`0010`.
   Non modificare l'ambiente né riavviare su un branch separato.

**Accettazione del risultato:** richiedere run conclusa `success` e
rilettura indipendente provider su UUID/giurisdizione, dieci entry contigue
nel ledger `d1_migrations`, view `sync_writable_cloud_key`, tabella
`health_erasure_finalizations`, trigger
`health_erasure_finalization_fence`, assenza di account/chiavi/job reali
e preservazione delle fixture sintetiche. Un run fallito o un ledger parziale
resta **BLOCCATO**: conservare il checkpoint Time Travel e diagnosticare
prima di ripetere. La sola conclusione del workflow non prova restore,
Auth Kinde, cifratura, replica/ACK, revoca o erasure end-to-end; non è GO
full-stack.

## Checkpoint B-03 storico post-merge, pre-migrazione D1 — 15/11/2026

La [PR #1135](https://github.com/gernotfound/logbook/pull/1135) è stata integrata
con squash in `main ed31c42af38e065dd448308e6c7d546ae80978e6` (v2.444.0). CI PR [#43662166211](https://github.com/gernotfound/logbook/actions/runs/43662166211), [Main Release Gate/CodeQL #43696757160](https://github.com/gernotfound/logbook/actions/runs/43696757160), [Worker API e Auth Gate privati #43696757245](https://github.com/gernotfound/logbook/actions/runs/43696757245), [Firestore #43696941939](https://github.com/gernotfound/logbook/actions/runs/43696941939) e [Cloudflare Static Assets/smoke #43696964223](https://github.com/gernotfound/logbook/actions/runs/43696964223) tutti **SUCCESS** sull'esatto SHA. Firestore non ha effettuato scritture: Rules e indici erano già convergenti.

La verifica diretta D1 successiva al merge conferma ancora **otto migrazioni
applicate su dieci** (`0001`–`0008`), giurisdizione EU, repliche disabilitate,
bookmark Time Travel disponibile e nessun principal/sessione/ADK/job erasure.
Il workflow manuale per `0009`/`0010` è ora presente in `main`, ma **non è
stato eseguito**. Per avviarlo servono un token separato di minimo privilegio
in GitHub Secrets e le verifiche preflight già implementate. Il successo dei
deploy e della CI non prova l'applicazione delle migrazioni, né autorizza il
GO di Auth, sync, cifratura cloud, consenso o cancellazione completa.

## Verifica provider Cloudflare storica pre-migrazione — 15/11/2026

Readback diretto Cloudflare su D1 `thelogbook-cf02-eu-isolated-20261113`:
giurisdizione `eu`, read replication disabilitata, bookmark Time Travel
disponibile. Il ledger contiene **otto migrazioni (0001–0008)**, mentre
`main` include anche `0009` (scritture replica subordinate alla custodia
ADK) e `0010` (prova atomica di cancellazione). Nessuna delle due è attestata
come applicata al provider. Sono stati letti soltanto aggregati: zero
principal Kinde/sessioni/ADK/job di cancellazione, con una fixture sintetica
di documento e ricevuta conservata. I Worker API e Auth Gate privati hanno
entrambi binding verso questa D1 e URL workers.dev/preview disabilitati; il
Worker frontend rimane separato con solo ASSETS. Il workflow Static Assets
su `main fd6570c6` è SUCCESS, ma non prova la migrazione API.

**Incremento B-03 integrato (PR #1135; workflow ancora non eseguito):** workflow manuale **solo su main**
`.github/workflows/cloudflare-d1-isolated-migrations.yml`, con guard
sull'esatto SHA di main già verificato, identità D1, schema in allowlist,
assenza di account veri, disponibilità Time Travel, applicazione ufficiale
Wrangler con backup e controllo SQL/ledger dopo l'applicazione. Richiede
un token GitHub separato `CLOUDFLARE_D1_API_TOKEN` con scope D1 write;
l'attuale token di deploy Workers aveva restituito 401 su D1 REST e non
deve essere ampliato. **Finché il workflow non viene eseguito e verificato,
D1 resta 0008/0010.** Non sono autorizzate route API pubbliche,
operazioni su account reali, OAuth Production, DNS o GO sanitario.

## Checkpoint storico precedente al merge B-03 — 15/11/2026

**HEAD verificato GitHub:** `f10dd7089a4633096869faf88482250fe26b8edc` (v2.442.0). Tutte le nove PR #1125–#1133 sono squash-merged, con **zero PR aperte** al checkpoint: C-02 (split test UI WebKit), B-01 (`0009` fence ADK/replica), B-02 (`0010` finalizzazione erasure atomica), A-06 (prova identità OIDC separata dal login verificato), A-04 (`emailVerified` attendibile), D-01 (UID consenso e diritti), A-01 (UID client), D-02a (runner con lease e proof primaria), C-01 (regressioni IDB journal/receipt). Sul candidato D-02a gli **otto test full-schema del finalizzatore** sono stati eseguiti, zero skip.

**Gate dello stesso SHA `main`:** [Milestone/Main Release Gate e CodeQL #43658661516](https://github.com/gernotfound/logbook/actions/runs/43658661516) **SUCCESS**; [Firestore #43658877933](https://github.com/gernotfound/logbook/actions/runs/43658877933) **SUCCESS**, nessuna modifica Rules/indici necessaria; [Cloudflare Static Assets #43658905338](https://github.com/gernotfound/logbook/actions/runs/43658905338) **SUCCESS al primo tentativo** con smoke HTTP non distruttivo su `thelogbook.me`. Il codice dei Worker privati è stato verificato in CI, ma i servizi reali e la D1 richiedono lettura diretta del provider per attestare configurazione e schema attuali.

**NO-GO full-stack:** all'ultima lettura provider Cloudflare del 14/11 la D1 sandbox riportava migrazioni `0001`–`0008`. L'integrazione di `0009/0010` **non ne prova l'applicazione remota**. Non sono stati attivati cron erasure, route Auth/Sync pubbliche, login Kinde reale, KEK/cloud keys e recovery verificati, export/diritti end-to-end, backup/restore anti-resurrection o GO sanitario; restano quote Free, Safari iOS/PWA e privacy. Non trasferire account/dati Firebase pre-lancio.

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
| GitHub | Incrementi integrati e candidati distinti nel checkpoint sopra e nell'epic #1053; prove exact-SHA nelle PR, nessuna review indipendente CRITICAL sostituita dalla sessione autrice. | Riallineamento/review dei candidati; la CI non prova login Kinde o API live |
| Static Assets | Provider riletto 15/11: `thelogbook-frontend` su `thelogbook.me`, solo `ASSETS`, `workers.dev`/preview disabilitati. Deploy e smoke exact-SHA registrati nelle PR integrate. | Installazione/update Safari iOS, comportamento guest, rollback e Auth cloud separata |
| D1 | Readback 15/11: sandbox `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu`, primaria EEUR, repliche off, ledger `0001`–`0010` applicato. Zero principal/sessioni/ADK/job; documento e receipt sintetici conservati. | Recupero, quote/CPU, custodia KEK e protezione anti-resurrection; nessun restore provato |
| Workers API/Auth | Provider riletto 15/11: Worker `thelogbook-api-isolated` e `thelogbook-cf03-auth-gate-isolated` privati, binding D1/`AUTH_GATE` e limiter; `workers.dev`/preview off e nessun binding KEK. La presenza dei servizi non è un test Auth HTTP live. | Kinde OAuth/password/Google reale, session scope, consenso/ADK, sync e recovery HTTP |
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

`src/lib/sync/cloudflareJournalCandidate.ts` compone il controllo replica e la lettura dei documenti con lo staging cifrato `stageCloudflareDelivery()` e il recupero della ricevuta `resumeCloudflareDelivery()`. Legge prima un eventuale intento già durevole, riutilizzandolo immutato; non sostituisce il writer Firestore nel frontend. I test isolati coprono ACK verificato, perdita della risposta, revisione mutata, cambio sessione, guest e CSRF assente. **Restano da integrare e collaudare** il candidato di recovery dopo 409 non committato, bootstrap/hydration e integrazione con Kinde/ADK reali: il candidato non va distribuito come sync funzionante. CI e merge hanno prove separate dal runtime Workers/D1.

### Incremento CF-05 — chiavi ADK/KEK su Workers/D1 (candidato isolato)

`cloudflare/api/cloud-key-crypto.mjs` è il codec WebCrypto AES-256-GCM di una ADK random per UID con AAD owner-bound, IV casuale, formato v1 stretto. `cloud-key-store.mjs` legge e rilascia la chiave wrappata solo attraverso claims fidati del private AuthGate e una nuova verifica SQL primaria di sessione, consenso, epoch e scopo. La creazione condizionale richiede consenso appena accettato, nessun documento/replica/ricevuta o job attivo e registro issuance assente per quella generazione; il trigger della migration `0007_cloud_key_custody.sql` crea la prova `cloud_key_issuance` **nella stessa transazione**. Anche senza la riga wrapped, un marker issuance persistente impedisce rigenerazione sopra dati orfani. I concorrenti leggono il winner salvato, senza credere a un ACK perso. Dopo revoca `rights-export` legge soltanto una ADK già presente, senza provisioning. Update della chiave vietato; DELETE richiede un job di erasure lease-fenced in fase `awaiting-keys`.

**Non attivato:** nessuna route API delle chiavi, secret Cloudflare o integrazione browser; la migration 0007 è installata nella D1 isolata ma non rilascia chiavi. La KEK v1 di Cloudflare richiede provisioning autorizzato, custodia esterna indipendente e prova di restore/rotation senza perdere ADK. Il SQL `0010` e il finalizzatore D-02a ora codificano cancellazione ADK e prova terminale atomiche, testate su SQLite sintetico; il job non è attivo sulla D1 remota. CF-08 deve ancora bloccare restore anti-resurrection. I test SQLite/fake AuthGate non certificano il runtime D1 Free, Kinde reale o GDPR.

## Integrazioni candidate presenti nel repository

**Provider OAuth/Kinde — configurazione amministrativa osservata, non login operativo (14/11/2026):** nel progetto Google Cloud `thelogbook-oauth` il pannello Audience mostra **Esterno / In produzione**; il proprietario conferma credenziali Google proprie impostate nella social connection Kinde `TheLogBook`, con **Email Password e Google attivi, Email Code/Phone/Username disattivati** come da screenshot. La schermata Kinde Details mostrava inizialmente tutti gli URI vuoti; il proprietario ha poi confermato **Application homepage URI = `https://thelogbook.me/` salvato**, senza read-back indipendente. **Application login URI, Allowed callback URLs, Allowed logout redirect URLs** non risultano configurati. L'indirizzo homepage Google OAuth è invece `https://thelogbook.me/about`; la callback `https://thelogbook.kinde.com/login/callback` appartiene a **Google→Kinde**, non a **Kinde→Workers**. Le pagine statiche `/about` e `/privacy` sono state verificate con smoke Cloudflare [#43616173486](https://github.com/gernotfound/logbook/actions/runs/43616173486). Implementazione callback OAuth Code+PKCE con state/nonce monouso, sessione trusted, browser/Safari, password ≥15 anche reset ed email reale restano **NO-GO**. [Guida dettagliata Kinde](kinde-auth-setup.md), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

**Google Branding / Search Console — provider verificati da screenshot del proprietario (14/11/2026):** Search Console ha mostrato **«Proprietà verificata»** per la nuova proprietà Dominio `thelogbook.me`, dopo che l'integrazione con Cloudflare ha autorizzato l'inserimento di un TXT DNS. Il TXT non va rimosso. La prima richiesta di verifica Branding aveva segnalato la homepage `https://thelogbook.me/about` non registrata al proprietario; dopo la verifica dominio, il pannello Google OAuth `thelogbook-oauth` mostra **«Il tuo branding è stato verificato e viene mostrato agli utenti»**. Logo PWA, homepage `/about` e informativa `/privacy` sono visibili nel pannello. Questo chiude il gate amministrativo **proprietà dominio/Branding Google**, non il test OAuth, il controllo di scope e redirect client, i Termini pubblici o la revisione legale della Privacy. Non certifica login Kinde, API Worker, sessioni D1, sicurezza Auth o GO della release.

**Auth (CF-03):** `cloudflare/auth/kinde-token-verifier.mjs` verifica firma JWKS RS256, issuer, audience API, client/azp, scadenza e subject. `kinde-login-proof.mjs` verifica in più ID token, audience distinta, `email_verified`, nonce, corrispondenza del soggetto e `at_hash` se presente. `kinde-principal-provisioner.mjs` è un candidato **interno, non un endpoint**: dopo quella verifica deriva un UID D1 stabile da SHA-256 con separazione di dominio su `(issuer, subject)` e inserisce una sola volta un principal verificato; una lettura primary-sequential conferma l'esito, senza riattivare principal disabled/deleted né azzerare epoch. Non importa dati Firebase e non salva email o salute. Il callback **candidato** crea e consuma `state` monouso server-side, effettua code exchange PKCE e passa il nonce originale a provisioner e `session-issuer.mjs` dopo prova autorevole; non è pubblicato né testato col tenant Kinde reale. In caso di risposta D1 ambigua non si emette una sessione. Resta da verificare revoca Kinde e modifica successiva dello stato email. `session-gate.mjs` controlla sessione e autorizzazioni per gli accessi successivi. Mai accettare UID o nonce direttamente dal client come prova sufficiente. [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

**Replica (CF-01/02/04):** `cloudflare/api/worker.mjs`, `d1-document-store.mjs` e `replica-maintenance.mjs` definiscono il trasporto D1 con SQL CAS, session/consent fence e receipt. `cloudReplicaDurableDelivery.ts` e i moduli contigui persistono il batch ciphertext e il prefisso journal in IndexedDB **prima** della rete; una ricevuta originale verificata autorizza solo l'ACK di quel prefisso, mai un successo su timeout o stato ambiguo. È vietato esporre un'API con AuthGate sintetico o collegare D1 a `replicateJournal()` prima del percorso identità/consenso reale. [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058).

**Consenso, cifratura e cancellazione (CF-05/06):** migrazioni `0003`–`0010`, custodia ADK, job e runner D-02a sono integrate. Dopo il drain bounded, una sola istruzione SQL `0010` finalizza ADK, prova terminale e job `complete` con lease valido; un ACK ambiguo richiede readback D1 primaria e `awaiting-keys` da solo non basta. Gli 8 test di finalizzazione sono passati sullo schema SQLite sintetico. Lo schema è applicato sulla D1 isolata; mancano esecuzione trusted end-to-end dei job, cron, export, account Kinde, retention e restore anti-resurrection. La DEK device e la chiave cloud account rimangono indipendenti. Non promettere E2EE/zero-knowledge né recupero impossibile. [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059) · [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060).

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
queste route né contiene binding D1/KEK. Le migrazioni 0001–0010 sono installate **solo nella sandbox D1 EU** (readback 15/11);
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

### CF-02 — worker privati collegati, distinzione token D1 (14/11/2026)

Il merge [#1117](https://github.com/gernotfound/logbook/pull/1117)
su `main f3fc9b138e62bfc1fc6beb22ce6f2c7ba5d4e2f0` ha superato
Canonical Verification e Main Release Gate; CodeQL sul push main è verde.
La [run privata #43638837192](https://github.com/gernotfound/logbook/actions/runs/43638837192)
ha compilato e caricato i Worker, confermando in Wrangler binding D1 e
service e **nessuna route pubblica**. Readback indipendente del provider
Cloudflare: due Worker privati presenti, `DB` collegata alla stessa D1 EU
`9aa51833-8adc-495f-bdfc-93b5542e8023`, `AUTH_GATE` corretto,
rate limiter presente, workers.dev e preview disabilitati. Frontend live
rimane con solo `ASSETS`. **Non equivale a chiamata API autenticata,
session issuance Kinde, consenso browser o sync funzionante.**

Il passo finale della run ha fallito HTTP 401 sul **read D1** con il
token di deploy GitHub; le permissions di D1 non vanno aggiunte a un token
Workers destinato alla pubblicazione. La lettura del ledger 0001–0008 e
la giurisdizione EU è stata svolta direttamente con il plugin Cloudflare,
con autorizzazione indipendente. Una PR correttiva rende il readback CI
least-privilege sui binding Worker (negativi su 401, DB sbagliata, route
pubbliche e gate assente); non presenta la sola CI come prova di schema.

### CF-03 — test verticale Kinde → consenso → D1 (solo sintetico)

La suite `tests/cloudflare/cf03-kinde-http-worker.node.mjs` attraversa insieme i **moduli reali** di callback OAuth, emissione cookie sessione, AuthGate, primo consenso e replica D1. Applica lo schema corrente `0001`–`0010` a SQLite e usa token RS256 firmati localmente, mai credenziali del provider. Verifica rifiuto prima del consenso, CSRF, accettazione esplicita, accesso ADK prima dell'iscrizione della replica, isolamento di due owner, revoca con job ancora `pending` e logout con revoca sessione. La registrazione della replica **non** attesta cifratura AEAD, commit documenti, ACK o restore.

Questo è un test **Node/SQLite sintetico**, non un collaudo HTTP del Worker live, una prova Kinde reale, email/password/Google, Safari, sincronizzazione cross-device o recupero dei dati. Il candidato HTTP Kinde resta **non pubblicato**; gli URL e secret provider devono essere riletti e verificati prima della pubblicazione. CI/SHA e limitazioni sono tracciati in [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

### CF-03 — adapter client sessione/consenso e POST OAuth (candidato isolato)

Il modulo `src/lib/auth/kindeCandidateClient.ts` prepara il **confine di applicazione** per Kinde senza modificare l'attuale `AuthContext` Firebase e senza avviare fetch automatiche. La lettura consultiva usa solo endpoint HTTP same-origin (`/api/auth/session` e `/v1/consent/status`), credenziali cookie, no-store, controllo dei campi e ricontrollo finale UID/epoch/revisione, con guard del chiamante per cambi di generazione. Rifiuta errori trasporto, app shell HTML, redirect e inconsistenze; `signed-out` è distinto da `unavailable`. Non pubblica dati sanitari, non tocca IndexedDB, non riconosce il consenso guest e non avanza ACK.

L'avvio OAuth è predisposto come navigazione HTML `POST /api/auth/kinde/start` **senza body applicativo**; `fetch` non può leggere in sicurezza un redirect 303 cross-origin opaque. Il candidato `cloudflare/auth/kinde-http-worker.mjs` ora ammette una form POST con stream di **zero byte**, verificando dimensione effettiva prima del rate limiter e del salvataggio dello state; ogni byte non vuoto è rifiutato. Test sintetici Node + Vitest coprono la forma di navigazione, i rifiuti e la lettura client con fence. Il Worker HTTP Kinde e l'adapter **non sono montati nel frontend pubblico**: non hanno route reali e non attestano login/email/Google, quota, consenso browser, ADK, sync o recovery. Attivazione, UX guest→account e integrazione `AuthProvider` rimangono gate separati e non possono riutilizzare Firebase `User` come identità Kinde.

### CF-03/04 — precondizione ADK e revoca concorrente

Il claim distingue `428 cloud-key-required` dalla custodia incoerente o dal guasto D1 (`503`), dalla revoca (`403`) e dal conflitto CAS (`409`). Dopo un fallimento SQL per ADK assente, sessione, consenso, revisione e assenza di dati/chiavi sono letti **nella stessa SELECT primaria**: una revoca o un claim concorrente intervenuti prima di quella lettura non possono diventare una nuova autorizzazione al provisioning. Il client conserva intent e journal; la precondizione non è un ACK né una concessione della chiave. La suite ADK usa tutte le migrazioni canoniche e il finalizzatore atomico effettivo, con regressioni su sessione/revoca intercalate, claim vincente concorrente e guasto della lettura primaria. Sono prove sintetiche, non login Kinde, custodia KEK o sync live.

### CF-03 — consolidamento PR #1209 e controllo dipendenze (18/11/2026, candidato)

Il branch `fix/cf03-kinde-cookie-continuity-20261117` riunisce le modifiche
CF-03/04/05/06/08 preesistenti (sessione e guest Kinde, consenso, chiavi,
journal/replica e registro D1 indipendente per revoca/erasure). La mitigazione
del blocco `npm audit` GHSA-fc5q-39xc-vjpf deriva dalla PR #1214:
fork locale `picomatch@4.0.8-logbook.0` con regressioni ReDoS e correzione
separata di Code scanning #29 (eliminazione regex polinomiale).

Il monitor `.github/workflows/picomatch-upstream-watch.yml` interroga ogni
giorno l'advisory e la pubblicazione della versione stabile ufficiale su npm.
Apre una sola issue di sostituzione del fork, senza aggiornare pacchetti,
fare merge o deploy. Un errore dell'API non crea false notifiche.
`npm audit` non analizza la sorgente `file:` come una versione del registry:
il fork resta temporaneo e non può essere dichiarato ufficialmente sicuro.

La PR non certifica il runtime Kinde, Google, email/reset, l'assenza di
Firebase nel frontend completo, Auth/D1 Workers reali, binding/cron
Production, diritto all'erasure, Safari o sync multi-device. I test di
fixture e CI sono prove distinte dai provider; nessuna risorsa reale è
stata modificata in questa attività.

### CF-03 — ritiro del proxy Firebase Hosting dal dominio pubblico (18/11/2026)

Il Worker Static Assets non inoltra più richieste /__/auth/* all'origin
firebaseapp.com. Il router applicativo espone esclusivamente le quattro route
Kinde già sottoposte al controllo del Worker privato; ogni percorso storico
del helper Firebase risponde 404 no-store. Le regressioni esercitano metodi,
binding mancanti, header non fidati, fallimenti 401 e l'assenza di richieste
esterne; il controllo di configurazione rifiuta il ripristino del namespace.
Il Service Worker continua a negare le navigazioni /__/ in modo conservativo.

**Confine della prova:** si tratta del solo ritiro del collegamento proxy
Firebase sul bordo pubblico, non della rimozione dell'SDK Firebase dal bundle
o dall'AuthProvider, né della sostituzione del journal Firestore. Fino alla
sostituzione verificata, l'app account e i suoi servizi cloud restano NO-GO
e non vengono riparati con un fallback al vecchio provider.

### CF-08 — operatore per migrazioni del registro indipendente (18/11/2026)

Il D1 applicativo è a 0010. Al checkpoint del 18/11 il registro indipendente
era a 0002. Il workflow Cloudflare recovery D1 è manuale e riservato a
`main`. Applica lo schema del registro isolato tramite Wrangler.

Prima della scrittura controlla SHA di main e relativo release gate,
target D1 esatto, ledger continuo, giurisdizione EU, repliche disabilitate,
bookmark Time Travel, modalita' sealed e zero proprietari. Dopo l'operazione
controlla le 4 migrazioni, trigger, tabella, coda cutoff vuota e stato sealed.
Non usa il workflow precedente del D1 app, che legittimamente si ferma
sulla presenza di identita': lettura live 18/11, 2 principals, 24 sessions,
zero ADK e zero erasure jobs. Non dichiarare tali record eliminabili.

**Verifica 19/11/2026.** Le migrazioni `0003` e `0004` sono applicate sul
registro D1 EU isolato. SQL dallo SHA `d3add65964a4bd668cc9a978fc897539d6b687c1`,
gate GitHub verificato e un batch D1 Query API per migrazione, ciascuno con
controllo del ledger e dell'isolamento, seguito dalla registrazione della
migrazione. È stato verificato un bookmark Time Travel prima della
scrittura. Il readback conferma ledger fino a `0004`, trigger e coda,
registro `sealed`, generazione 1, zero proprietari e zero cutoff.
L'Action manuale rimane disponibile per verificare il ledger. Restore,
custodia KEK, consenso e sync integrati restano da collaudare sul provider.
Vedi [issue #1062](https://github.com/gernotfound/logbook/issues/1062#issuecomment-6995742809).

### CF-03 — owner neutrale per la ripresa del journal (18/11/2026)

La ripresa in foreground del journal di `src/store/useAppStore.ts`
non legge più direttamente `auth.currentUser` dall'SDK Firebase: confronta
l'owner con la sorgente di identità già presente
`authenticatedIdentitySource`, che nel codice legacy è ancora
registrata da Firebase e nel futuro percorso Kinde sarà registrata
esclusivamente dal nuovo provider. Identità assente, differente o
illeggibile bloccano la ripresa senza svuotare il journal. Il controllo
non costituisce da solo prova di sessione/consenso, che continua
a essere richiesta dai gate esistenti su ogni operazione.

L'AuthProvider e il writer Firestore non sono ancora sostituiti:
questo è un disaccoppiamento dell'owner locale, non l'attivazione
delle repliche Kinde né un ACK cloud.

### CF-03 — catalogo locale senza import Firebase (18/11/2026)

Il modulo `catalogService.ts` risolve memoria, IndexedDB, validazione e
seed locali senza importare `firebase/firestore`. Il vecchio
`syncGlobalCatalog()` Firestore vive ora in
`firestoreCatalogAdapter.ts` ed e' richiamato soltanto dal loader cloud
legacy e dai test dedicati. I metodi, il timeout, la validazione dei
macronutrienti e la cache rimangono invariati. Il percorso guest/offline
non importa Firestore per leggere alimenti ed esercizi attraverso il
catalogo. Per la sostituzione completa del provider cloud occorre ancora
sostituire il loader, i writer e l'AuthProvider Firebase; l'adapter
legacy sara' eliminato insieme a quel percorso verificato, non prima.

### CF-04 — rifiuto del falso successo in assenza di Auth Firebase (18/11/2026)

Rimosso da `DB.saveUserData()` il ritorno immediato
`{ok:true,status:'synced'}` in assenza di `auth.currentUser`.
Il metodo delega sempre al boundary di replica già protetto da
journal durevole, owner/epoch e consenso. Un account con pending
locale e Firebase già disconnesso conserva le operazioni e non
mostra un cloud ACK inventato. L'account Kinde non diventa
automaticamente sincronizzato: il nuovo writer D1 dovrà essere
collegato e verificato prima del GO.

### CF-03 — parsing Kinde bounded anche dopo gli header (18/11/2026)

Il parser dei payload Kinde verifica `no-store`, JSON e limiti di
dimensione, e ora possiede un deadline autonomo anche durante il
consumo dello stream. Una risposta frammentata ma completa resta
accettata; una sospesa viene rifiutata senza attribuire identita'
o autorizzazioni. Non cambia il modello D1, l'AuthProvider legacy
o il GO delle API sanitarie.

### CF-03 — logout guest separato da Firebase (18/11/2026)

Il logout della modalita' ospite e' ora una funzione riutilizzabile
senza dipendenze di login Firebase. Mantiene conferma esplicita,
testimone della generazione, Web Lock, revoca durevole e
purge/cancellazione soltanto dell'owner guest. La funzione
richiede al provider soltanto un'operazione di purge autenticata
dal lifecycle locale; non trasferisce dati a Kinde e non abilita
account o replica Cloudflare prima del GO.

### CF-03 — identita' del purge locale provider-neutral (18/11/2026)

Il preflight, il lock e il controllo successivo alla pulizia
dell'owner locale non consultano piu' direttamente Firebase:
usano `authenticatedIdentitySource.readUid()` e il separato
owner hint conservativo. Il guard e' il medesimo, con rigetto
in caso di nuova identita' o sessione guest. Il provider Kinde
non viene registrato in parallelo a Firebase, ne' i record D1
attuali vengono adottati o cancellati.

### CF-05 — prova JSON diritti cloud dopo revoca (19/11/2026)

Il candidato `src/lib/auth/kindeCandidateRightsExport.ts` trasforma il
checkpoint cifrato `/v1/rights/scan`, interamente verificato AEAD con
ADK effimera e sessione Kinde fissata, in JSON leggibile esportabile su
richiesta. Etichetta espressamente i documenti **rimasti leggibili**;
non promette uno snapshot completo dell'archivio iniziale se il job
`health_erasure_jobs` è già in `processing`. Non comprende envelope
IndexedDB, journal pendente, workout/timer o bozze del dispositivo, e non
usa il formato importabile `logbook-backup`. Il limite di generazione
JSON in memoria è 64 MiB; l'errore non produce un file parziale.
La richiesta di download non equivale a conferma di un file salvato.

La funzione non è richiamata dal frontend pubblico: `identityOnly`
e assenza di binding `D1_API` restano invariati. Prima del GO:
integrazione UX, unione affidabile delle copie device e cloud,
esportazione facoltativa prima della revoca e collaudo browser/provider
su risorse isolate; KEK reale, cancellazione ed erasure restano gate
separati.

### CF-05 — raccolta di prove cloud + dispositivo prima della revoca (19/11/2026)

Il candidato `kindeCandidatePreWithdrawalExport.ts` prepara un unico
JSON `thelogbook-prewithdrawal-evidence` con **due archivi separati**:
checkpoint cloud D1 aperto con ADK effimera e revision-pinned, e
envelope IndexedDB cifrato letto/validato in memoria con il journal
locale non consegnato e le copie device recuperabili (workout, timer,
draft e testimonianze). La scansione device rigorosa e' stata estratta
dal backup Firebase in `backupDeviceSnapshot.ts` e condivisa con il
percorso Kinde, senza aggiungere dipendenze Firebase.

Sessione Kinde, consenso attivo, CSRF, vault owner-scoped e generazione
sono verificati anche dopo le attese; la rilettura dell'envelope e
delle copie device rifiuta cambi concorrenti osservabili senza
nasconderli. Non esiste transazione cross-resource e il file non
fonde semanticamente i due dataset, non prova ACK o recuperabilita'
di qualunque cosa non consegnata, e **non e' importabile come backup
Schema 3**. Nessuna mutazione di storage o provider, attivazione UI,
grant fitness o binding D1 pubblico. Il download su richiesta non prova
il salvataggio del browser.

Attivazione differita: definire il backup business portabile realmente
ricostruito dai dati causali, verificare copie e proposte di recupero
local-only, aggiungere UI informata *prima* della revoca ed eseguire
prove di Browser/WebKit e provider isolate. Il frontend corrente
resta `identityOnly`, `candidatePreparationEnabled:false`;
nessun GO sanitario.

### CF-05 — candidato portabile Schema 3 con replay causale senza side effect (19/11/2026)

Il modulo `kindeCandidatePortableBackup.ts` crea un backup business
`logbook-backup` Schema 3 sotto consenso D1 attivo, sessione Kinde,
CSRF e vault già sbloccato. La lettura dei documenti AEAD Cloudflare
e la doppia prova delle copie IndexedDB/localStorage provengono
dall'ingresso candidato pre-revoca; una prova finale dopo ogni attesa
asincrona della composizione impedisce di pubblicare copie locali cambiate
nel frattempo. Root/shard, causal frontier
e normalizzazione lossless sono verificati prima del merge; le
modifiche non consegnate sono composte tramite `applySemanticOperations`
usato anche dalla replica, senza inviare commit o ACK. L'output
contiene anche documenti cloud raw, envelope con journal e
testimonianze device per recovery esplicito.

È intenzionalmente conservativo: differenze non risolvibili,
operazioni in volo, archivio sospeso o prova locale perduta
rifiutano il formato restorable e lasciano disponibile il precedente
JSON di evidenze separate. Il parser di Backup Schema 3 è stato
separato dal writer di ripristino bozze per evitare Firebase nel
percorso Kinde. Nessuna API o binding `D1_API` pubblico,
nessuna schermata di revoca Kinde attiva e nessuna mutazione
provider. Prima dell'attivazione completare UI accessibile
di esportazione volontaria e revoca, test Safari/WebKit/browser
reale e collaudo KEK/diritti/cancellazione/restore su provider isolato.

### CF-05 — controllo export candidato React prima della revoca (19/11/2026)

Il percorso candidato Kinde include ora un pannello esplicito
`KindeCandidateBackupPanel` che prepara un JSON Schema 3 tramite
`prepareCandidateBackup`: verifica identità/sessione/consenso,
riapre soltanto un vault già esistente e rilascia sempre la relativa
chiave device. L'utente ottiene un vero link per il gesto di
download successivo, non un click automatico dopo le richieste HTTP;
il file contiene informazioni sanitarie in chiaro e non si assume
mai che il sistema operativo lo abbia salvato. Rimuovere il link,
cambiare sessione o smontare la vista revoca il Blob URL; il click
deve avere ancora il cookie Kinde e il consenso locale corrente.

**Non pubblico:** `main.tsx` continua a imporre
`identityOnly:true` e `candidatePreparationEnabled:false`.
Il pannello non esegue revoca, non importa dati né attiva fitness,
non aggiunge binding `D1_API`, Worker API o deploy sanitario.
Servono collaudi browser/provider reali e integrazione esplicita
della revoca con offerta facoltativa di backup prima di un GO.

### CF-05 — workflow React candidato revoca → diritti (19/11/2026)

La UI isolata `KindeCandidateWithdrawalPanel` unisce l'offerta
volontaria del backup pre-revoca Schema 3, una conferma separata
dell'avvio della cancellazione sanitaria, l'invio condizionale tramite
`withdrawKindeCandidateHealthConsent()` e la riconciliazione
read-only del marker `pending:1` dopo un possibile ACK perso.
Non viene ripetuto alcun POST dopo una risposta ambigua. Anche
con email non più verificata la revoca rimane possibile, ma
il percorso di backup completo che richiede il vault fitness resta
negato. `KindeCandidateRightsPanel` prepara un file **separato e non
ripristinabile** con i soli documenti cloud ancora leggibili mentre
il job è in corso; un job già in elaborazione può aver eliminato parte
dei documenti senza mutare la revisione, e il server rifiuta quando
il cutoff impedisce ulteriori letture.

`KindeCandidateJsonPanel` gestisce download browser con URL
temporanei, verifiche di sessione e cleanup senza prova fittizia
di file realmente salvato. Le nuove funzioni sono richiamabili
soltanto con `identityOnly:false` e **due** flag candidati espliciti;
`App.tsx` e `KindeAccountSessionProvider` continuano a negare
fitness, revoca, diritti e D1 API pubblici. Non sono stati eseguiti
interventi sui dati o sulla configurazione dei provider; test con
fixture Worker/D1 sono differenti dai collaudi KEK, Safari,
account reali e recovery/erasure del provider.


### CF-05 — ripristino Schema 3 su dispositivo Kinde candidato (19/11/2026)

L'ingresso non pubblico `restoreKindeCandidateBackup` integra il
percorso import `decodeImport` → `prepareImport('restore')` con il
bootstrap Kinde/D1, un refresh autenticato del cloud, il commit business
e journal cifrati nello stesso update IndexedDB e la consegna tramite
l'adapter D1 con receipt verificata. Rifiuta backup parziali o di altro
owner e transizioni locali non riconciliate. Un conflitto, una risposta
persa o un cambio sessione conserva il batch e il file originale;
`local-pending` e `cloud-acknowledged` non sono sinonimi.

Il percorso è solo candidato: nessun collegamento alla UI pubblica,
nessuna modifica di provider o secret, nessun trapianto automatico di
bozze device, journal, repliche o consenso. Le regressioni isolate
`kindeCandidateRestore.test.ts` esercitano Worker/API D1 sintetici e
IndexedDB; il loro esito non prova KEK reale, provider Production,
Safari/iOS o recupero dopo perdita effettiva del dispositivo. Il
fitness rimane NO-GO fino ai collaudi completi.


### CF-05 — ingresso ripristino e installazione pre-login (19/11/2026)

Il frontend identity-only offre l'azione PWA solo quando Chromium fornisce
un evento `beforeinstallprompt` differito; Safari/iOS mostra l'istruzione
manuale, senza simulare un popup. Le due richieste 401 dopo logout sono
intenzionali: revoca verificata dal server e riconciliazione UI. Il candidato
non pubblico Kinde aggiunge scelta e conferma esplicita del JSON Schema 3
prima di invocare il restore owner-scoped; esiti `local-pending` e
`cloud-acknowledged` sono distinti. Nessuna nuova rotta D1 pubblica,
nessun consenso automatico, nessuna attivazione account fitness.


### CF-05 — prova integrata end-to-end candidata con D1 sintetico (19/11/2026)

La suite tests/isolated/sync/kindeCandidateLifecycleJourney.test.ts percorre
nello stesso scenario sessione Auth verificata, consenso esplicito via Worker,
creazione vault, primo journal cifrato + receipt D1, edit rimasto offline,
backup Schema 3 completo, secondo profilo vuoto/sessione diversa, hydration
autenticata dal cloud e restore esplicito della modifica fino a seconda receipt.
Verifica inoltre chiavi device e replica distinte, isolamento altro UID,
assenza di plaintext nel documento SQL e rifiuto del bootstrap post-revoca,
senza cancellare il journal locale o inventare erasure completata.

Le route, AuthGate, Workers, migrazioni e adapter client sono quelli reali
del repository; D1 e KEK sono sintetiche (SQLite in memoria) e la sessione
verificata viene creata dal trusted issuer della fixture, non tramite OAuth
Kinde esterno. Il secondo dispositivo è una simulazione con nuovo profilo
IndexedDB/localStorage, non Safari/iPhone fisico. La suite NON prova
deployment runtime, quote o recovery della KEK indipendente e NON autorizza
l'attivazione pubblica fitness; il frontend conserva il boundary identity-only.


### CF-05 — ambito readiness locale Kinde isolato (20/11/2026)

`src/lib/auth/kindeCandidateLocalReadiness.ts` è un adapter candidato
non montato nella PWA pubblica. Usa le route e i controlli D1 già presenti,
`prepareKindeCandidateOwner({drainPendingJournal:true, retainDeviceVault:false})`,
riapertura temporanea della DEK, verifica della replica e rilettura
del consenso autorevole. La callback riceve soltanto una vista owner +
session fence, senza installare identity reader o concedere permessi fitness.
La DEK viene chiusa in `finally` anche se la callback fallisce o la sessione
cambia; gli I/O cloud futuri devono autenticarsi indipendentemente a ogni
operazione. Test isolati usano Worker/AuthGate reali e D1 sintetico in memoria.
Non sono state create nuove D1 Cloudflare, attivate route o cambiate chiavi.
