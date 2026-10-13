# TheLogBook — validazione cloud trusted e funzionamento offline (CRITICAL)

> **STATO: PROPOSTA ARCHITETTURALE, NON IMPLEMENTATA.** Baseline verificata direttamente su GitHub: gernotfound/logbook, main SHA 7617a226201d81824785580ef87164f2a7705ffb (14 ottobre 2026). La presenza di questa specifica non certifica un nuovo endpoint, una migrazione, quote del provider, nuovi test runtime o nuove Security Rules. Rispettare AGENTS.md, le regole storage-and-sync, domain-operations, crash-consistency, firebase-config e ci-verification.

## 1. Problema e perimetro

**Confermato dal codice:** attualmente il client autenticato può scrivere direttamente il documento root users/{uid}, gli shard history_months/{YYYY-MM} e nutrition_months/{YYYY-MM}, oltre al registro sync_control/state. Le Firestore Rules richiedono owner e consenso attivo trusted, Sync Protocol 3, fencing replica, limiti strutturali e cardinalità mensili (256 allenamenti, 31 giornate), nonché actor causali s00–s15. Non applicano a ogni record business dinamico l'intera validazione dello schema applicativo.

Un client modificato intenzionalmente dall'owner può quindi tentare un payload business incoerente pur superando diversi controlli Firestore. Non è stata dimostrata una violazione cross-UID, né perdita di dati reali. L'owner autorizzato può sempre scegliere misure soggettivamente false: qui la garanzia ottenibile riguarda coerenza strutturale e semantica, non la verità materiale delle annotazioni.

**Difesa esistente:** transactionWriter.ts normalizza, verifica identità/date mensili, usa UserDataSchema, merger causale e confronto lossless dei dati remoti. La correzione delle proprietà dinamiche delle PR #385 e #387 e l'hardening delle Rules nelle PR #378 e #386 sono già parte della baseline. Non chiamare una nuova allowlist parziale o un trigger di pulizia post-write una validazione completa.

## 2. Invarianti del percorso attuale

1. La UI invia Domain Operations, che passano da commitDomainOperations in localRepository.ts: stato business + SemanticOperation/journal vengono persistiti atomicamente nel medesimo update IndexedDB dell'archivio cifrato per owner.
2. replicateJournal.ts lavora **dopo** il commit locale; controlla sessione, consenso legale e sanitario, App Check e replica. Rete o backend indisponibile non possono annullare il salvataggio locale.
3. transactionWriter.ts usa una transazione Firestore per leggere il registro replica e massimo **8 documenti business**, applica semantic merge e scrive documento/i + sync_control.lastSeq insieme. Impone slot/replicaId/generation/lease, schema e Sync Protocol 3.
4. acknowledgeThrough mantiene il journal più recente, assorbe lo stato causale confermato e rigioca soltanto le nuove modifiche locali. Un commit remoto con risposta persa non giustifica un falso acknowledgement.
5. Il caricamento cloud distingue mesi non letti, mancanti e record non validi; la replica parziale non giustifica cancellazione di mesi locali. Il vault si riapre offline alle condizioni di account/consenso già validate.

**Non negoziabili:** l'editing offline non attende un server; nessun dato pending viene scartato per un timeout; nessuna write di una generazione replica revocata; no delete fisica dei documenti mensili tramite client; no reinitialization distruttiva di vault/journal; versione futura sconosciuta fail-closed; backup ed export rispettano il consenso vigente.

## 3. Alternative confrontate

| Scelta | Benefici | Rischi/limiti | Valutazione |
| --- | --- | --- | --- |
| Mantenere Rules + gateway Zod client | Nessun nuovo servizio/costo/rischio di disponibilità | Client owner modificato può aggirare validazione business | **Baseline** finché la soluzione nuova non è verificata |
| Filtri parziali nelle Rules o pulizia post-write | Poco codice | La write incoerente può essere già visibile, non copre tutti i record e rischia sanitizzazioni distruttive | **Non idonea** alla garanzia completa |
| Richiedere server prima del commit locale | Backend più semplice | Impedisce editing offline e aumenta rischio di perdita | **Esclusa** |
| Un gateway server trusted per **sole write cloud** | Valida ogni documento risultante prima della persistenza remota | Nuovo fault domain/costo; migrazione delicata per client vecchi, fencing e ack | **Candidata** |
| Event log cloud totalmente nuovo | Proiezioni server-authoritative | Nuovo schema/GC/migrazione e alto rischio di compatibilità | Non giustificato adesso |

## 4. Architettura candidata

**La UI e IndexedDB rimangono invariati.** Il journal locale accumula dati durevoli anche senza rete. Solo al momento della replica online, il batch SemanticOperation viene trasmesso a un gateway trusted, che valida e scrive su Firestore usando Firebase Admin. La risposta contiene una prova recuperabile della transazione per l'ack locale.

### Contratto del gateway

- Identità UID derivata esclusivamente dal Firebase ID token valido, controllato lato server (anche revoca); App Check verificato. Il client non può scegliere il destinatario UID tramite body. Origin/CORS corretti sono difese aggiuntive, non autenticazione.
- Il server deve leggere e controllare **nella stessa transazione** consenso sanitario trusted/revision, barriera account-deletion, sync_control e tutti i documenti interessati. Firebase Admin **bypassa Firestore Rules**: i controlli che oggi appartengono alle Rules vanno riprodotti esplicitamente e testati in negativo sul boundary trusted.
- Richiesta limitata per dimensione, numero di operazioni e numero di documenti; ammettere soltanto path/schema/versione/guard/actor/dot noti e sequenze compatibili con lease, slot e generazione replica. Non accettare JSON libero che sostituisca interi documenti cloud.
- Refactoring in un core **puro condiviso** del semantic merge e della validazione canonical: testare il suo comportamento senza Firebase Web SDK, browser storage o stato globale di sessione. L'implementazione server è l'unica autorizzata a committare le write cloud.
- Verifica strict e lossless del **documento business risultante**, inclusi record dinamici history/nutrition, relazioni chiave-ID, date/mese, schema e metadata field stamps/candidates. I parser Zod che applicano fallback non bastano come validazione server di input non attendibile: nessun record dev'essere corretto o omesso tacitamente durante un commit.
- Un solo commit atomico business + control + eventuale ricevuta di idempotenza; nessun successo remoto prima del commit verificato. Il gateway restituisce dati/metadata causali per l'attuale replay/ack; errori distinti: retryable, auth/consent revoked, stale replica, schema incompatibile, input rifiutato, conflitto.
- Nessun payload salute, token, workout/meal text nei log. Rate limiting e limiti di budget vanno verificati, non solo documentati.

### Risposta persa e idempotenza

Un batch può essere stato committato anche se il browser riceve timeout o 5xx. Definire identità di richiesta legata a owner, slot, generazione, intervallo seq e digest canonico del contenuto. La prova di esecuzione/receipt deve essere atomica alla write; ritentare l'identico batch restituisce lo stesso risultato e un payload diverso con la stessa identità viene respinto.

Non trattare il solo valore di sync_control.lastSeq come prova del payload: certifica una frontiera, non il contenuto del batch. Se la ricevuta ha retention limitata, progettare esplicitamente una prova alternativa per dispositivi offline oltre quella retention; non cancellare ricevute che sono ancora necessarie per recovery. Calcolare e verificare il costo delle write aggiuntive.

### Fencing, vecchie PWA e dati locali

- Il nuovo writer deve gestire anche **registrazione/checkpoint/advance del registro replica**, non lasciare due autorità cloud non equivalenti.
- Le Firestore Rules dovranno negare le write business dirette soltanto **dopo** la disponibilità di un client compatibile e di un piano per versioni PWA cached/vecchi service worker. Letture owner possono restare dirette con Rules/Auth/App Check, ma non consentono write bypass.
- Client vecchi con journal pendente devono avere update-required + recovery/export prima del cutover, senza perdere dati. Non offrire una finestra permanente di write dirette, che renderebbe fittizia l'autorità del gateway.
- La revoca consente solo gli usi previsti dall'attuale policy di consenso; non ri-etichettare come consentiti batch vecchi. Non annullare il journal locale per una rejection server o un upgrade.
- Il backend è una nuova dipendenza della **replica**, non della **registrazione offline**. Guasti/rate limit → journal rimane durevole e visibile come pending se verificato; retry con backoff, checkpoint e recupero controllato. Nessuna conferma ottimistica né silenziosa perdita di dati.

## 5. Sequenza di implementazione sicura

**Fase A — core/test condiviso, senza cambiare il runtime Production.** Estrarre il pure merge/validation contract in moduli usabili nel server e nel client; fixture identiche a transactionWriter e test di equivalenza/fuzz. Conservare invariati salvataggio IndexedDB, Firestore Rules e flusso cloud esistente. Non creare un nuovo writer Production.

**Fase B — gateway soltanto su Firebase Test isolato.** Implementare autentificazione, App Check, consent/revision, barriera deletion, rate limit, strict validation, idempotenza, transactional commits e recovery. Firebase Test è ancora da creare (ToDo.md). Validare permessi Firebase Admin e limiti reali/costi Vercel. Non attivare piani con fatturazione senza decisione esplicita del product owner.

**Fase C — collaudi avversariali e compatibilità.** Emulator Rules, API Firebase Test reale, Playwright login, worker/reload, dati sintetici, due dispositivi, tre o più replay, failover e richiamo del consenso. Verificare tempi, quota, cold start, regione/privacy. Nessun dual-write verso Production come test.

**Fase D — rilascio coordinato.** Prima client capace di usare il gateway e opzioni di aggiornamento/recupero per client vecchi. Solo dopo, cutover delle Rules che blocca le write dirette; attivare il gateway come **unica autorità**. Gate canonico exact-SHA, review e squash merge, CI main, Vercel Production verificato, Firestore readback live e Hosting smoke. Il rollback dev'essere un protocollo verificato, non un temporaneo indebolimento delle Rules.

**Fase E — osservabilità e rollout.** Monitorare rejection rate tecnico, queue depth senza dati salute, timeout/rate-limit, costi e capacità. Dimostrare assenza di duplicati, ack falso, perdita dopo reload e corretto comportamento nelle finestre di revoca/account deletion.

## 6. Test di accettazione da rendere bloccanti prima del cutover

| Caso | Proprietà attesa |
| --- | --- |
| Offline prolungato, reload, vault riaperto | Modifiche disponibili e journal integro senza il gateway |
| Upload perso prima del commit | Pending durevole; nessun cloud ack |
| Commit riuscito ma risposta persa | Stessa ricevuta al retry, nessun duplicato, ack sicuro |
| Modifica locale durante remote commit → ack | Replay conserva la modifica più recente |
| Due device / due tab / tombstone / slot riassegnato | Convergenza causale, generation fencing |
| Payload business mensile o FieldStamp malformato | Rifiuto prima della write; zero modifica parziale |
| UID differente, Auth/App Check assente, consenso revocato | Accesso/scrittura negati anche all'Admin gateway |
| Account deletion mentre un batch è in volo | Barriera transazionale impedisce la write |
| Schema futuro/campo sconosciuto o remote già corrotto | No downgrade, perdita o riscrittura distruttiva |
| Backend 5xx/429/quota, token scaduto | Sync pending/recovery; utilizzo offline invariato |
| PWA cached pre-cutover con dati ancora pending | Update-required/export e recupero senza wipe |

## 7. Decisioni e prove mancanti

**Scelta tecnica consigliata:** un solo writer cloud trusted **dopo** il journal locale, mantenendo il boundary offline attuale. L'implementazione autorizzabile per prima è la **Fase A**, non un cutover prematuro.

**Non ancora dimostrati:** disponibilità di Firebase Test separato, IAM ed enforcement esatti del gateway, capacità/costo Vercel per questa workload, tenuta operativa del gateway, recupero di vecchi client e approvazione degli eventuali costi esterni. Nessun nuovo endpoint, config provider o traffico Production modificato da questo documento.

Una volta verificate le fasi A–C, la decisione di procedere al cutover deve basarsi su evidenze di sicurezza **e** disponibilità. Una semplice CI verde non è una prova del runtime.
