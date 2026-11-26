# Consenso e diritti salute Kinde/D1 — candidato CF-05/06

**Quando leggere:** consenso iniziale Kinde, revoca, riaccettazione, rights-only, export ed erasure D1, inclusi race, lost ACK e recovery.

**Non inferire:** consenso guest, snapshot locale o prova di job non autorizzano il cloud né provano cancellazione completa.

**Autorità:** [Consenso salute](health-consent.md), [`AGENTS.md`](../../AGENTS.md), [Ciclo account](account-lifecycle.md) e [stato Cloudflare](../../docs/operations/cloudflare-current-state.md).

## CF-06 — Confine fra revoca salute e cancellazione account

La finalizzazione sanitaria richiede il lease D1 esatto ancora valido nella scrittura terminale (#1403), non un controllo antecedente; in caso di lease scaduto non distruggere ADK né produrre ricevute. La pipeline account candidata (#1404/#1405) aggiunge deny indipendente e prova Kinde-last; non confondere la ricevuta di revoca o la finalizzazione dei soli dati salute con cancellazione account completa. Il marker attività dell'account non è prova di consenso. Il percorso account, incluso enqueue inattività e cron, non è attivato: vedere [Ciclo account](account-lifecycle.md) e [CF-06](https://github.com/gernotfound/logbook/issues/1060).

## CF-05 — Ingresso React candidato: revoca e diritti senza GO fitness (19/11/2026)

Il solo ingresso Kinde **candidato** può esporre revoca e diritti quando
una modalità esplicita `candidateMode` è selezionata,
`candidateLifecycleEnabled:true` è attivo e `identityOnly:false`.
Il pubblico continua `identityOnly:true`,
`candidatePreparationEnabled:false`; la nuova impostazione non è un
permesso per pubblicare la D1 API o attivare account fitness.

La UI deve proporre il backup JSON **facoltativo e pre-revoca** prima
della decisione distruttiva, senza richiederne il salvataggio. Una
checkbox separata deve confermare sia la revoca sia l'avvio della
cancellazione sanitaria: il click di download non ne attesta il
salvataggio. L'azione Kinde riceve solo UID/epoch/revisione dalla
sessione corrente; il trusted `withdrawKindeCandidateHealthConsent`
conferma lo stato server e persiste il marker owner-scoped
`pending:1` **prima** del POST. Perdita della risposta, rete offline,
stato locale non leggibile o sessione diversa non autorizzano retry
automatico né pulizia del marker: l'unico recupero è la riconciliazione
read-only. Il marker locale non attesta mai erasure completata.

La revoca rimane disponibile anche se l'email Kinde non è più
verificata, purché la sessione abbia il consenso originario verificato
dal Worker. In quel caso **non** si consente il backup completo che
richiede il gate fitness; il diritto di revoca non dipende dall'export.
Il percorso rights-only offre un JSON distinto di documenti cloud
ancora leggibili, solo dopo la prova server di revoca e job pendente;
non apre il vault device, non esegue sync e non diventa Schema 3.
La UI espone i limiti di copertura, la potenziale cancellazione già
iniziata, la custodia del plaintext e la possibilità di fallimento
legittimo durante l'erasure. Il download è un secondo gesto sincrono
del browser, con URL temporaneo distrutto su unmount, cambio sessione,
scarto o disabilitazione; non è una ricevuta di salvataggio.

La logica condivisa del Blob URL vive in
`kindeCandidatePreparedJson.ts`; la vista riutilizzabile è
`KindeCandidateJsonPanel` e non contiene autorizzazioni fitness.
La sola presenza dell'ingresso candidato non configura un ambiente
sanitario reale, una prova di KEK recovery o un GO.


## CF-05 — Checkpoint di esportazione rights-only Kinde (candidato 19/11/2026)

Il solo percorso candidato `withKindeCandidateRightsCheckpoint()` può recuperare documenti **ancora cifrati** di un account che ha revocato il consenso ma ha un job sanitario `pending|processing`. Il suo trasporto usa esclusivamente `POST /v1/rights/scan`, mai `/v1/sync/*`, senza commit, ACK, riapertura del vault locale o installazione di un owner fitness. Il Worker richiede sessione Auth D1 attuale, cookie CSRF valido, owner derivato dalla sessione (mai dal body), consenso originale, revoca SQL e job non completato, oltre al registro `RECOVERY_DB` indipendente ancora aperto e senza cutoff; ricontrolla lo stato e il registro dopo la pagina prima di rispondere. Le pagine sono bounded (otto documenti), coerenti con una sola revisione e non possono diventare checkpoint incompleti o mescolati.

Il client acquisisce temporaneamente la ADK per lo scopo `rights-export`, verifica AEAD per **tutti** i documenti e rimette a zero i byte della chiave al termine o al fallimento. L'email diventata successivamente non verificata non impedisce questo diritto se la sessione Auth resta valida; la stessa sessione non può però ottenere lo scope fitness. Un cutoff di cancellazione, una risposta non canonica, un cambio cookie/UID o la corruzione di un documento interrompono la lettura senza pubblicare un risultato parziale. Il callback consumer è soltanto **composizione per il futuro export**: non è un download JSON, un'esportazione completa e non include dati esclusivamente locali, journal pendenti o bozze device. Nessun diritto di cancellazione finale o GO pubblico è concesso da questo checkpoint. Il `KindeAccountSessionProvider` pubblico mantiene identity-only e la configurazione frontend continua a non esporre `D1_API`.

## CF-05 — Riconciliazione read-only dopo risposta di revoca persa (19/11/2026)

`reconcileKindeCandidateWithdrawal()` è un percorso **candidato non montato** nel runtime pubblico. Viene chiamato solo quando esiste già un marker owner-scoped `pending:1` oppure `withdrawn`; nessun marker assente o corrotto viene creato o normalizzato. Fissa cookie CSRF, UID Kinde, sessione e consent epoch prima della prima richiesta e usa soltanto le letture trusted `/api/auth/session` e `/v1/consent/status`. **Non ripete** `POST /v1/consent/withdraw`, non sblocca vault o fitness e non cancella dati.

Se la primaria D1 attesta `withdrawn` (inclusa la generazione terminale ammessa dal contratto SQL), il client può avanzare atomicamente nel senso della sicurezza il marker locale da `pending:1` a `withdrawn`; il risultato significa **soltanto revoca confermata**, non erasure `complete` né export eseguito. Con stato remoto ancora `active`, errore di rete, sessione/cookie mutati, marker sostituito, risposta malformata o storage non scrivibile la decisione locale rimane bloccante: nessuna cancellazione automatica di `pending:1`, nessun nuovo POST, nessuna autorizzazione al sync. Il recupero di una decisione pendente con remoto ancora `active` richiede un futuro percorso prodotto esplicito e sicuro, non lo sblocco implicito dopo timeout. Le regressioni attraversano il Worker/AuthGate/D1 con dati sintetici, perdita risposta dopo commit e prima invio, cambio sessione e failure storage.

## Revoca Kinde e custodia rights-only — client candidato (19/11/2026)

`withdrawKindeCandidateHealthConsent()` è un ingresso browser **non montato** nel provider React: richiede decisione esplicita di cancellazione (con offerta preventiva di export a carico della futura UI), sessione Kinde e consenso D1 `active` dello stesso UID/epoch/revisione 1. Prima del POST scrive il marker durevole owner-scoped `pending:1`, che blocca fitness e journal cross-tab anche su errore di rete. L'assenza di storage impedisce il POST. Il payload è esattamente `withdraw`/`expectedRevision: 1`/`confirmsErasure: true`; non effettua replay dopo un ACK perduto. Solo una ricevuta `deletionStatus: pending|processing` del Worker più rilettura trusted `withdrawn` consentono il marker `withdrawn`: **mai** erasure `complete`, purge o riaccettazione implicita. Un pending ambiguo resta da riconciliare tramite prova server indipendente, non basta il marker locale.

`withKindeCandidateRightsKey()` è il candidato separato per un'ADK **già esistente**, purpose `rights-export`; revalida la sessione Kinde prima/dopo l'acquisizione e l'uso, accetta anche l'email successivamente non verificata, e azzera i byte dopo il callback anche in caso di errore. Non chiama `sync`, non apre vault, non installa owner, non crea chiavi, non effettua export documenti o cleanup. Il Worker resta l'autorità SQL sullo stato `withdrawn` e sulla prova di consenso originale: l'ADK da sola non equivale all'esportazione dei dati. Nessun GO finché export JSON completo, job readback dopo lost ACK, lifecycle React/UI, dati reali e worker/KEK non sono verificati: il nuovo scan candidato copre solo ciphertext cloud ancora presenti.



## Lettura dello stato dopo erasure terminale D1 (16/11/2026)

Quando il finalizzatore SQL `0010` porta `sync_subjects` da consenso 1/epoch 1 a
consenso 2/epoch 2, l'epoch del principal Auth può rimanere 1: la sessione
valida non diventa automaticamente una nuova autorizzazione fitness.
Il solo endpoint trusted `/v1/consent/status` può restituire `withdrawn`
per la generazione successiva, **solo** se il DB primario conferma la
prova terminale immutabile, il job `complete`, il floor di cancellazione
e l'incremento esatto di una epoch. Il lettore candidato accetta quel
risultato esclusivamente come `consent-suspended`; non come
`consent-confirmed`, nuovo consenso, sync, export o ACK.
Il Worker candidato restituisce la generazione terminale solo dopo verifica
della stessa generazione nel registro D1 indipendente e nuova verifica della
sessione nella primaria applicativa.

Una subject epoch successiva senza prova terminale, un owner/sessione
variato o uno stato `active` con epoch diversa continuano a fallire chiusi.
Una risposta `withdrawn` non attesta da sola erasure completa:
per la finalizzazione occorre la prova SQL esatta, e per il recovery da
backup resta necessario il guard esterno anti-resurrection CF-08.
Questi percorsi restano candidati finché Auth/consenso/chiavi e revoca
sono collaudati sul runtime pubblico previsto.

## Prova legale trusted per il bootstrap Kinde cifrato (18/11/2026, candidato)

Il lettore `readKindeCandidateAccess()` conserva i campi `acceptedAt`, versione
Privacy e versione Termini soltanto dallo stato `consent-confirmed` della D1 primaria,
dopo due prove della stessa sessione, UID, epoca e revisione. Lo stato attivo
riporta `observedAtMs` dalla stessa lettura primaria. L'istante di accettazione
deve essere UTC ISO canonico, senza normalizzazioni e al più pari a questa
osservazione, anche quando l'orologio del browser è disallineato. La stessa
validazione si applica alla risposta del primo consenso e alla verifica
prima della revoca. La prova legale persistita conserva la data di accettazione.
Il checkpoint completo confronta anche la prova legale prima e dopo la scansione AEAD.

`hydrateKindeCandidateArchive()` installa questa prova nel baseline cifrato
device anche quando non esiste un root business. Non crea pending/ACK,
non registra replica né trasferisce il consenso guest. Gli edit locali
journalizzati restano preservati. La prova locale **non autorizza fitness o
sync D1**: sessione, revoca, vault, replica e runtime restano gate distinti.
## Primo consenso Kinde → D1: chiamante browser candidato (15/11/2026)

Il client `src/lib/auth/kindeCandidateConsent.ts` genera il corpo esatto
`accept-initial` soltanto dopo tre conferme esplicite separate del maggiorenne,
Termini e trattamento dati salute. Una sessione Kinde verificata senza riga
consenso non autorizza altro. Il chiamante richiede CSRF per-sessione,
rifiuta switch identità/epoch e accetta successo solo dopo una nuova lettura
del consenso `active` sulla stessa identità con versioni legali attuali.
La schermata fissa il cookie prima della lettura dell'identità e lega il
modulo alla stessa sessione, UID ed epoch. Se cambia il cookie, anche per un
nuovo accesso con lo stesso UID, il modulo non invia il consenso. Una nuova
verifica azzera le tre scelte. Il preflight prima della scrittura confronta
l'owner restituito con quello del modulo e rifiuta ogni differenza.
Una risposta SQL persa/409/503 si riconcilia tramite la prova remota, **non**
con replay del POST o ottimismo UI. Il Worker candidato registra prima il floor
indipendente `pending`, poi l'accettazione immutabile nel D1 applicativo.
Prima di restituire `active` conferma entrambe le primarie con la stessa
generazione. Se la promozione del floor rimane indietro, la lettura autenticata
del consenso può riconciliare la prova già scritta solo con CSRF, email verificata,
versioni legali correnti e floor `pending` esistente. Una copia ripristinata
senza floor non può registrarsi da sola. Il guest può esprimere il primo consenso
account prima del trasferimento: nessuna eredità del consenso locale guest,
nessun trasferimento o purge implicito. Non collegato alla UX corrente;
email, policy password e provider runtime restano gate autonomi.

## Candidato Cloudflare D1 — revoca e cancellazione in attesa (14/11/2026)

La migration `0005_health_withdrawal_queue.sql` e la route privata
`POST /v1/consent/withdraw` sono **solo codice candidato**, non servizi
distribuiti né erasure completa. Il backend accetta soltanto l'intenzione
esplicita `action: withdraw`, `expectedRevision: 1`,
`confirmsErasure: true` con sessione corrente e CSRF; riattesta il
principal e la prova del consenso nella stessa SQL di INSERT del job.
Prima dell'INSERT, il registro indipendente deve attestare il deny per
l'esatta generazione sanitaria. La migration recovery `0003` consente
`pending → blocked` se la prima accettazione ha già committato sulla primaria,
evitando di renderla attiva per poterla revocare. Se la scrittura del job
fallisce, il deny rimane e una richiesta autorizzata può riconciliare la
revoca. La risposta richiede il job primario e la revoca registrata anche
nel D1 indipendente.
Un trigger esegue atomicamente `sync_subjects.status = withdrawn`,
impedendo nuove operazioni replica anche se la risposta viene persa.
D1 primaria deve attestare sessione, revoca e job prima della risposta
`deletionStatus: pending`. La richiesta di revoca non è bloccata dalla
perdita successiva di `emailVerified` o da una revisione legale nuova.
Non confondere il job `pending` con dati cancellati, né richiamare il
vecchio job Firestore per completare un job D1. Il runner D1, la gestione
dei diritti, ADK, riaccettazione, recovery e prove runtime sono ancora
mancanti. L'UI deve fermare localmente il trattamento fitness prima
della richiesta HTTP, offrendo l'export facoltativo prima della conferma.
Dopo il ritiro non deve riesumare journal o ciphertext dell'epoch precedente.

## CF-06 — progresso cancellazione D1 (candidato, non in servizio)

Dopo il job di revoca `0005`, la migration `0006` e il Worker privato
`cloudflare/jobs/health-erasure-worker.mjs` consentono la cancellazione
dei soli record di replica, al massimo quattro righe per invocazione e
con lease di 30 secondi verificato in ciascuna DELETE. Il candidato non
ha una route pubblica né un cron configurato. Un eventuale job in
`phase=awaiting-keys` rimane **`status=processing`**, e blocca ancora
la riaccettazione: mancano verifica delle altre risorse, custodia/
distruzione ADK, retention e receipt finale. Un `DELETE` riuscito o un
document scan vuoto non prova erasure completa. L'API di revoca può
restituire `deletionStatus=processing` dopo verifica trusted, senza
abilitare fitness, export incompleto o ricreare dati precedenti.
La migration aggiunge anche vincoli SQL per bloccare la riscrittura
diretta di documenti/repliche dopo la revoca e la riattivazione di
consenso finché esiste un job incompleto. Richieste fallite, quote,
lease scaduti o response-loss restano recuperabili e non causano una
conferma di cancellazione. Il runner corrente ordina le richieste eleggibili
per il massimo fra timestamp di richiesta e scadenza del lease precedente,
poi richiesta e UID. Un errore di un owner dopo il claim non monopolizza
la coda: il suo retry rientra al termine del lease, senza modificare le
condizioni autorizzative o produrre una ricevuta. La riconciliazione di un
cutoff già prenotato può fallire senza bloccare il passo di un altro owner,
che richiede la propria fence indipendente; il tick resta fallito, senza
attribuire una ricevuta al cutoff. Gate globale o prenotazione non provati
interrompono il tick prima di qualsiasi passo. Il tick sanitario cattura
la generazione recovery aperta una sola volta; prenotazione e cutoff la
verificano nella SQL e nel readback, la fence owner, i passi applicativi e
la prova terminale la mantengono fino all'esito. Un cambio globale non è
un errore isolabile per owner; un effetto già committato resta recuperabile
senza ACK. La quiescenza prima del restore resta indispensabile. L'enrollment e l'attestazione
iniziale runtime (`requireOpen`) e la pubblicazione del floor terminale
vincolano la scrittura e la rilettura alla stessa generazione aperta del
registro indipendente. Seal/reopen durante la prova invalida l'esito;
un commit già avvenuto resta monotono. Non è una transazione cross-D1:
prima di restore servono arresto e quiescenza verificati dei writer.

## Contratto Workers/D1 per erasure e recovery

### Contratto candidato Workers/D1 dopo la migration `0010` (15/11/2026)

**MUST:** `cloudflare/api/migrations/0010_atomic_health_erasure_finalization.sql` e `cloudflare/jobs/health-erasure-worker.mjs` autorizzano `awaiting-keys → complete` esclusivamente tramite SQL atomica `INSERT ... SELECT ... RETURNING` che verifica UID, consenso, epoch, lease, assenza di documenti/ricevute/mutazioni/repliche e ADK. Il runner effettua readback primario della prova durevole anche dopo ACK perso; non dichiara `complete` da una chiave mancante o da `RETURNING` vuoto. Il consenso server ora restituisce UID trusted; il client candidato lo verifica anche negli scambi identità A→B→A. La lettura ADK rights-only non abilita fitness e richiede sessione valida e job di erasure coerente.

Il candidato `scheduled` richiede due binding distinti. Verifica la generazione
revocata nel registro indipendente prima delle scritture applicative. Durante
la fase chiave registra il blocco irreversibile dell'export con la migration
recovery `0004` prima della cancellazione ADK. La sola barriera non attesta
erasure. Pubblica la generazione terminale dopo la prova primaria di `0010`.
Ogni invocazione può riservare un solo tentativo di riconciliazione scaduto,
oltre a un solo passo applicativo bounded. Un tentativo ambiguo conserva il
blocco e differisce il proprio retry; la pubblicazione del floor chiude la
riconciliazione in una singola transazione del registro.

**MUST (ordine dei job):** il runner ordinario seleziona la richiesta eleggibile più vecchia fra `data` e `awaiting-keys`, senza priorità fissa alla fase dati. Nuove richieste non possono rimandare indefinitamente una finalizzazione precedente. La selezione non attribuisce il lease: il CAS successivo ricontrolla fase, owner, generazione ed epoch; un lease non scaduto resta escluso. Il helper dedicato alle sole chiavi conserva il filtro esplicito.

**VERIFY:** presenza dello schema D1 e codice del runner non provano l'esecuzione dei job. Per le migrazioni effettivamente applicate consultare il [runbook corrente](../../docs/operations/cloudflare-workers-migration.md) e rileggere il provider. Cron, OAuth rights-only, account deletion, retention e restore anti-resurrection restano gate separati. I contratti Firestore/Vercel sopra descrivono ancora il vecchio codice applicativo e non provano la migrazione del runtime.

