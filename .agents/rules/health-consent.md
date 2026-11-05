# Consenso salute, diritti e cancellazione dei dati — TheLogBook

**Quando leggere:** primo consenso trusted, revoca/riaccettazione, generazioni offline, export diritti e health-data erasure.
**Non inferire:** cache locale, consenso guest o sola uguaglianza UID non attestano un'autorizzazione cloud corrente.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Decisione di prodotto e boundary

La revoca sospende tutte le funzioni fitness; rimangono informativa, diritti/esportazione, cancellazione e nuova accettazione separata esplicita. Nessuna modalità fitness ridotta. La revoca da sola non cancella dati, account o chiavi.

Guest: consenso e revoca sono locali alla generazione del dispositivo; nessun consenso server account viene ereditato dal guest. Account: lo stato autorevole è `health_consent_withdrawals/{uid}`, server-only; `legalConsent` business non lo sostituisce.

Fonti: `src/lib/healthConsent.ts`, `healthConsentRecovery.ts`, `src/contexts/auth/consentLifecycle.ts`, `src/lib/sync/localConsentReconciliation.ts`, `localConsentJournalRecovery.ts`, `server/healthConsent/`, endpoint `api/health-consent*`/`api/health-data-erasure.ts` e `firestore.rules`.

## Matrice sintetica delle autorizzazioni

| Stato | Fitness locale | Cloud e diritti |
|---|---|---|
| Primo consenso account non confermato dal backend trusted | Bloccato | Nessuna replica; informativa e diritti applicabili disponibili |
| Consenso attivo già attestato, vault e sessione coerenti | Disponibile anche offline per la generazione verificata | Replica solo con guard Auth/App Check/consenso correnti |
| Revoca locale o trusted | Sospeso | Nessuna nuova scrittura fitness; export diritti e cancellazione sono percorsi separati |
| Riaccettazione esplicita **solo offline** di generazione già attestata | Solo dispositivo già verificato | Cloud bloccato fino a riconciliazione trusted di revoca, riaccettazione e revisioni |
| Cancellazione sanitaria in corso | Bloccato | Nessun export dichiarato completo e nessuna riaccettazione che bypassi il job |
| Cancellazione sanitaria `complete` | Purge locale protetto prima di ripartire | Firebase Auth rimane; le vecchie generazioni non possono sincronizzare dati eliminati |

La tabella non autorizza prime attivazioni offline né replay automatici di journal appartenenti a revisioni precedenti. Le condizioni della transazione e le prove server delle sezioni seguenti sono normative.

## Primo consenso e prove server

**MUST:** le Rules negano l'accesso business finché manca `health_consent_withdrawals/{uid}`, `status: active`, `revision >= 1`, `uid` corrispondente al proprietario e la presenza dei campi `acceptedAt`, `privacyVersion`, `termsVersion`. Per rispettare il limite di 1.000 espressioni delle transazioni Protocol 3, la validazione semantica dei campi (timestamp ISO valido e versioni non vuote) è obbligatoria nel GET trusted e nel client, non attribuita alle Rules. Il record rimane server-only e la risposta invalida non può autorizzare la PWA. Il backend trusted registra il primo consenso esplicito tramite `POST /api/health-consent` (`accept-initial`, revision attesa zero, Firebase Auth + App Check limited-use). Il client verifica il contratto GET v2 e la sua epoch prima di qualsiasi lettura/scrittura cloud. L'assenza del record non è un consenso implicito; `legalConsent` sul root client non costituisce prova trusted. Registro repliche e `_sync.writer` richiedono `consentRevision` coerente; le collection private non supportate restano negate per impostazione predefinita.

**MUST:** l'accesso locale offline è consentito soltanto a una generazione già verificata e riaperta dal vault sicuro; la cache locale non può autorizzare un primo consenso o cloud I/O. Le revisioni ritardate/revocate non possono essere rietichettate o caricate silenziosamente. Il flusso guest→account preserva intenzioni e dati, e la prima accettazione viene salvata una sola volta sul server prima del cutover client/Rules coordinato.

**MUST:** `POST /api/health-consent` richiede il claim server-side `email_verified === true` per `accept-initial` e `reaccept`, che attivano il trattamento fitness. La verifica di UID, ID token non revocato e App Check limited-use consumato si applica anche a `GET` e alla revoca `withdraw`, ma il claim email non deve bloccare né la consultazione dello stato né la revoca dei propri consensi.
Anche cancellazione account, registrazione credenziale di recovery ed esportazione durante consenso revocato restano disponibili al titolare autenticato quando l'email non è più verificabile. L'export trusted richiede UID derivato dal token, stato `withdrawn` attestato dal server e App Check; non accetta UID forniti dal client.

## Ripresa offline e riconciliazione delle revisioni

**MUST:** Per un account con consenso iniziale *già attestato* dal server è consentita una nuova scelta esplicita offline dopo revoca locale. Il nuovo consenso abilita **esclusivamente** il dispositivo già verificato; marker persistente e revisioni mantengono il debito di revoca e riaccettazione sul server.
`isHealthConsentCloudWritable` deve restare falso durante tale fase, anche se la rete torna disponibile. Il backend riceve prima la revoca relativa alla generazione nota e poi la riaccettazione attuale, entrambe con CAS; un GET trusted successivo deve confermare revisione e versioni legali prima di sbloccare la replica.

Gli utenti al primo consenso, nuove identità, account non verificati, revisioni non attendibili e consenso legale scaduto non possono ottenere riattivazione offline. Una revoca più recente da un altro dispositivo sospende l'accesso; un'accettazione più recente richiede una scelta esplicita. Per le scelte esplicite `KEEP`, `WITHDRAW` e `REACCEPT`, l'UID invariato non dimostra continuità della sessione: una transizione Auth A→B→A durante GET o adozione IndexedDB deve invalidare la scelta precedente prima di modificare il journal o inviare il POST.

Journal e ciphertext precedenti restano recuperabili e non si riproducono automaticamente nella nuova generazione. Le copie workout device-critical rimaste prima del commit IndexedDB sono un intento separato dal journal: le nuove copie associano la revisione locale di consenso e non possono essere rigiocate in una revisione differente. Gli intenti account senza prova di origine restano conservati e non sono caricati automaticamente nel journal, nemmeno nella prima generazione.

Anche una copia IndexedDB senza pending può contenere dati cancellati dal server: se il limite trusted `erasedBeforeRevision` include la revisione dell'envelope esistente, la transizione alla nuova revisione rimane bloccata **dentro la transazione locale**, conservando l'originale senza autorizzare accesso fitness o replica. Questo stato è distinto dal recupero delle modifiche offline: i dati cancellati non possono essere reimportati automaticamente. L'utente può esportare una copia e scegliere un logout protetto per ripartire dal cloud; il journal pendente continua a rispettare i gate esistenti.

Il recupero esplicito di un vecchio journal richiede una seconda verifica trusted della revisione e del limite server `erasedBeforeRevision` dopo la scansione cloud, prima del commit IndexedDB; se la revisione cambia o la cancellazione ha raggiunto il journal originale, nessuna nuova operazione viene creata. Un errore di rete o App Check non equivale a consenso cloud confermato.

## Sessione e compensazione

**MUST (CRITICAL, compensazione del consenso rifiutato):** il rollback locale di `submitLegalConsent` passa a `revertRejectedConsent` un guard obbligatorio della sessione catturata. Verificarlo prima dell'accesso e nella callback atomica IndexedDB, anche se il risultato sarebbe no-op. Un cambio epoch Auth (incluso ritorno allo stesso UID), marker di revoca o generazione consenso invalida la risposta tardiva: preservare ciphertext, dati e journal. La disponibilità del vault e l'uguaglianza del valore di consenso non dimostrano continuità della sessione; restano separati il controllo del consenso atteso e la protezione degli intenti già acknowledged.


**MUST (owner e consenso asincroni):** risposte trusted e scelte esplicite del consenso non possono pubblicare revisioni o modificare IndexedDB dopo un cambio UID; ricontrollare identità/decisione dopo le attese e nel commit locale. Il drenaggio del journal deve verificare l'UID anche dopo la lettura IndexedDB prima del flush globale.

**MUST (export dopo revoca):** l'esportazione Admin dei dati cifrati con consenso revocato controlla anche `account_deletions/{uid}` prima e dopo ciascuna pagina, compreso il checkpoint finale. Qualunque job di cancellazione account, anche `complete`, sospende l'export: la revisione del solo consenso non basta a provare la coerenza durante una cancellazione account concorrente.

## Cancellazione dei soli dati dopo revoca (mantenendo Firebase Auth)

**MUST:** l'azione distinta «Elimina definitivamente i miei dati» è visibile solo al titolare di account con revoca salute confermata dal server, mai come effetto implicito della revoca. Richiede rete, due conferme consapevoli, recente autenticazione Firebase, verifica ID token con revocation check e App Check limited-use consumato. Il server determina sempre l'UID dal token, non dall'input.

`health_data_erasures/{uid}` è un job amministrativo server-only, riprendibile con lease, pagine bounded e cron. L'export privilegiato durante la revoca non dichiara una copia cloud completa se un job di cancellazione salute è attivo: verifica revisione trusted e stato del job prima e dopo ogni pagina, e il client richiede un checkpoint conclusivo dopo l'ultima pagina. La riaccettazione aggiorna solo il registro server-only del consenso, non il root business fuori da `_sync`. Il job non cancella **Firebase Auth, il marker di consenso o il marker di revoca delle sessioni**. Elimina le collection business Firestore dell'account e il root, poi verifica l'assenza anche di collection inattese. Un residuo sconosciuto impedisce il completamento; una cancellazione parziale non equivale a successo. `recordHealthConsentReacceptance` rifiuta qualsiasi job non completato.

**MUST (TheLogBook 2.0.0, chiave cloud):** il job di cancellazione sanitaria mantiene `user_data_keys/{uid}` fino a quando TUTTE le raccolte note sono state cancellate e l'assenza di residui privati imprevisti è stata verificata. Una cancellazione parziale, un errore, un timeout o un lease perso **non** distruggono la ADK prima dei dati cifrati. Solo la transazione finale lease-fenced che registra `complete` e avanza l'epoch ritira il record della ADK; la verifica `localPurgeAuthorized` richiede anche l'assenza della ADK. Il job di cancellazione account completa cancella comunque la propria ADK come record top-level server-only. La revoca senza cancellazione non distrugge la chiave: l'utente autenticato deve poter esportare e decifrare i dati con un'operazione rights-only finché la cancellazione non inizia.

**MUST:** al completamento il backend avanza **atomicamente** la revisione di consenso ancora `withdrawn` e registra `erasedBeforeRevision`. Una vecchia replica non può scrivere con la generazione cancellata. I retry dello stesso job sono idempotenti anche dopo l'avanzamento della revisione. La retention del job completo è 30 giorni; solo il cron con prova persistente dell'epoch può rimuoverlo.

**MUST:** il client può cancellare IndexedDB, device-critical e chiavi soltanto dopo stato `complete` letto dal proprio endpoint trusted; per una nuova pulizia dei soli dati salute la prova della revisione corrente deve essere ripetuta **dentro il lock esclusivo dell'owner**, immediatamente prima del fence. Un purge già interrotto e fenced resta riprendibile senza richiedere una seconda prova sotto lock. Il purge locale resta fenced fino alla prova di rimozione delle copie cifrate. Dopo la pulizia, effettua sign-out **senza eliminare Firebase Auth**. Se la connessione, la verifica del server o la pulizia locale fallisce, nessun messaggio deve dichiarare cancellazione completa.

**LIMITAZIONE:** dispositivi offline possono conservare copie vecchie impossibili da eliminare da remoto. Il protocollo impedisce la replica delle generazioni vecchie nel cloud; un successivo recupero esplicito di archivi precedenti richiede attenzione per non reintrodurre dati eliminati. Non dichiarare cancellazione universale di copie offline, fornitori esterni o backup non verificati.

**MUST (retention sanitaria):** il cron scansiona in ordine le ricevute `health_data_erasures` `complete` con `purgeAfter` scaduto. Ogni invocazione limita sia le cancellazioni sia i record ispezionati (al massimo il doppio del budget di cancellazioni). La cancellazione richiede una prova transazionale valida dell'UID, della revisione/epoch e di `erasedBeforeRevision`. Se la prova manca, il job non viene cancellato: la transazione rinvia `purgeAfter` di sette giorni e conserva la ricevuta per un nuovo tentativo. Il rinvio impedisce che gli stessi record non eliminabili blocchino indefinitamente quelli successivi tra cron consecutivi; non è prova di cancellazione né autorizzazione ad attenuare i controlli.

## Relazioni e limiti delle verifiche

- [Ciclo account](account-lifecycle.md): verifica email, guest→account, revoca globale sessioni, logout e account deletion sono failure path distinti.
- [Storage e sync](storage-and-sync.md): journal atomico, hydration, epoch e replica; [Bozze e stato device](device-drafts.md): provenienza anche per modifiche non ancora nel journal.
- [Portabilità](backup-and-portability.md): backup normale, copia device-only e export rights-only restano percorsi separati.
- [Archivio e cifratura](secure-storage.md): nessuna distruzione anticipata della chiave cloud o locale.
- [Decisione e gate](../../docs/compliance/health-consent-release-gate.md), [protocollo distribuito](../../docs/compliance/health-consent-technical-protocol.md) e [pacchetto compliance](../../docs/compliance/README.md) distinguono contratto tecnico, prove storiche e revisione legale/manuale ancora da eseguire. Non certificano conformità o runtime.
