# Dati salute e revoca del consenso — decisione e gate pre-pilot

> Stato: **SOLUZIONE A APPROVATA DAL PRODUCT OWNER IL 9 OTTOBRE 2026**. Implementazione candidata nella [PR #301](https://github.com/gernotfound/logbook/pull/301), **non distribuita**; verifica legale, configurazioni esterne e prove Production ancora aperte.
> Verifica tecnica precedente: 10 check CI superati sul commit `89cb37cae0f8bb143ef7346c2e8e4f32ddb37b0b` della PR; ogni nuovo commit richiede una nuova verifica exact-SHA. La vecchia baseline `5a9394649977cae4e2261e530312f5121818ce12` descriveva lo stato anteriore alla PR.
> Questo documento non costituisce un parere legale, una DPIA conclusa o un'autorizzazione al rilascio. Il pacchetto di approvazione e' in `health-consent-signoff.md`.
> Non certifica configurazioni Firebase/Vercel/Sentry Production.

## Perché esiste

La PWA tratta dati di allenamento, alimentazione, misurazioni corporee, sonno e annotazioni sui dolori. Alcuni di questi dati, per contenuto e contesto, possono rientrare nell'art. 9 GDPR; non tutti i singoli valori fitness vanno automaticamente classificati come dati sanitari. Il prodotto oggi richiede un consenso esplicito separato, ma non offre un percorso completo e verificato per revocarlo. Una semplice nuova checkbox non risolverebbe il problema: il trattamento comprende stato in memoria, copie locali e sincronizzate, dispositivi offline e fornitori.

Le basi giuridiche di **ogni finalità** devono essere validate (art. 6 e, quando applicabile, art. 9 GDPR). La necessità dei dati per erogare singole funzioni, la libertà del consenso e le conseguenze della revoca non possono essere decise dalla sola architettura.

Fonti istituzionali da utilizzare nella revisione:
- GDPR, artt. 6, 7(3), 9, 13, 17 e 25: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- EDPB, Linee guida 05/2020 sul consenso: https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en
- Garante Privacy, principi fondamentali: https://garanteprivacy.it/web/guest/home/principi-fondamentali-del-trattamento
- Garante Privacy, dispositivi e app fitness tracker: https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9968193

## Confini tecnici — candidatura PR #301 (non Production)

Questa tabella fotografa la **PR #301** e sostituisce il riepilogo precedente, ormai superato, che descriveva l'assenza del percorso di revoca.

| Confine | Comportamento proposto, verificabile nel branch | Limite residuo |
|---|---|---|
| UI e consenso | Azione di revoca in Impostazioni, esportazione JSON facoltativa prima della conferma, schermata di sospensione senza ri-consenso implicito | Informativa/titolare e basi legali da validare; UX Production e dispositivi reali da provare |
| Auth e richiesta trusted | Endpoint Vercel con ID token Firebase, App Check e marker idempotente `health_consent_revocations/{uid}` | Credenziali, IAM, App Check e origin Production vanno verificati dal provider |
| Firestore | Security Rules con barriera sul marker; cancellazione paginata e lease, verifica documenti annidati inattesi | Rules e nuovo indice composito non verificati live; test Emulator non sono Production |
| Client offline, sync e restore | Marker locale durevole, blocco salvataggi/journal, pulizia owner-scoped e protezioni su vecchi client | Una copia su dispositivo offline rimane fino alla riconnessione; impossibile dichiarare l'erasure di ogni device remoto |
| Recupero e monitoraggio | Retry cron di `requested/deleting/failed`, fairness e segnali aggregati; `blocked` richiede escalation | Non e' dimostrato alcun alert automatico/cron reale in Production |
| Account e conservazione | Firebase Auth mantenuto; account deletion rimane percorso separato; marker di revoca mantiene barriera | Base, durata e finalita' dei metadati residui da validare legalmente |

La fonte tecnica resta **lo SHA corrente della PR**, non questa descrizione. La CI su branch non prova il runtime live.


## Decisione di prodotto approvata: soluzione A; verifiche giuridiche aperte

1. **DECISO — soluzione A:** sospendere le funzioni di tracciamento e modifica dei dati salute quando l'utente revoca il consenso. Mantenere esclusivamente gli strumenti necessari per consultare questa informativa, esercitare i diritti e chiedere la cancellazione dell'account. L'esportazione completa, facoltativa, deve essere proposta prima di confermare la revoca. Non introdurre la soluzione B (uso fitness limitato). L'eventuale conservazione temporanea dopo revoca va giustificata giuridicamente e limitata; non autorizza una conservazione indefinita.
2. **Dati già conservati:** individuare per categoria ciò che va cancellato, ciò che può eventualmente restare su una diversa base valida, durata e modalità; valutare anche backend, cache locale, log e fornitori.
3. **Revoca offline:** definire quando la revoca diventa effettiva e come comunicare un eventuale stato pendente del cloud. Interrompere subito le operazioni locali dipendenti dal consenso; non dichiarare revocato sul cloud un trattamento finché non si è ottenuta prova della registrazione server.
4. **Re-consenso:** decidere se e come riattivare funzionalità senza reimportare/recreare dati cancellati, senza consentire a un altro dispositivo di sovrascrivere uno stato di revoca più recente.
5. **Ospite:** distinguere l'uso locale e la raccolta presso i fornitori; stabilire le modalità necessarie a esercitare i diritti nella modalità priva di account.
6. **Informativa e titolare:** correggere la descrizione della revoca, il canale di contatto e le basi giuridiche prima dei trattamenti per cui tali informazioni sono obbligatorie, non soltanto prima della vendita.

La decisione integrativa del 9 ottobre 2026 autorizza il comportamento futuro di cancellazione automatica dei dati di tracciamento non più giustificati dopo revoca, lasciando l'account attivo e offrendo l'esportazione facoltativa prima della revoca. Non autorizza operazioni retroattive su dati reali né il rilascio di un meccanismo incompleto. La scelta A **non autorizza conservazione indefinita**. Un consenso ritirato non giustifica il proseguimento di trattamenti fondati esclusivamente su di esso, inclusa la conservazione senza altra base valida. La gestione dei dati residui e delle richieste di cancellazione deve essere validata sotto i profili degli artt. 6, 9 e 17 GDPR prima del rilascio.

## Comportamento UX approvato per la soluzione A

- **Da Impostazioni → Privacy:** azione distinguibile `Revoca il consenso per i dati salute` con spiegazione anticipata delle conseguenze. Confermare la volontà di revoca senza creare ostacoli sproporzionati; l'eliminazione dei dati e dell'account è un'azione diversa.
- **Dopo la revoca:** schermata di sospensione dedicata, senza dashboard, workout, diario o funzionalità che richiedano il consenso. Restano accessibili informativa, strumenti di esercizio dei diritti applicabili e procedura di eliminazione account. Il backup completo è disponibile prima della revoca, non promesso dopo l'avvio della cancellazione. La schermata non può presentare `Accetta e continua` come scorciatoia per annullare la revoca.
- **Durante l'operazione:** bloccare subito le nuove modifiche/repliche dipendenti dal consenso. Distinguere visibilmente `revoca registrata`, `revoca in attesa di registrazione server` e `errore di registrazione`; mai comunicare un successo cloud non verificato.
- **Offline e più dispositivi:** registrare la richiesta localmente in modo durevole e fermare le operazioni locali interessate anche a riavvio e fra tab. Quando ritorna la rete, registrare/riconciliare in modo idempotente presso un confine autorevole del server, con difesa contro client obsoleti e richieste già in volo; nessuna operazione di scrittura precedentemente pendente deve ripristinare il trattamento revocato.
- **Esportazione e cancellazione:** offrire l'esportazione facoltativa prima di confermare la revoca, senza imporla quale condizione. Dopo la conferma non promettere esportabilità dei dati da cancellare. Non compromettere il distinto percorso di account deletion/recovery. Gli interventi irreversibili richiedono intenzione e conferma distinte; verificare la base giuridica e la durata dell'eventuale conservazione temporanea destinata alla gestione dei diritti.
- **Riattivazione futura:** nessun re-consenso implicito da sessione vecchia, refresh, import/backup o modifica di `legalConsent` lato client. Un eventuale nuovo flusso di consenso esplicito va progettato e approvato separatamente.
- **Utenti ospiti:** la sospensione riguarda le funzioni che dipendono dal consenso anche senza account, ma non va equiparato lo storage solo locale all'invio cloud; verificare finalità e confini dei trattamenti.

## Vincoli giuridici non risolti

Secondo GDPR art. 7(3) e Linee guida EDPB 05/2020, la revoca deve essere facile quanto il consenso; cessano le operazioni fondate solo su quel consenso, **compresa l'ulteriore conservazione se non esiste altra base valida**. La soluzione A non può promettere dati esportabili per un periodo indefinito senza una base giuridica appropriata. Prima del rilascio del candidato runtime, la revisione privacy deve definire chiaramente i trattamenti residui e i termini minimi strettamente necessari, le eccezioni legittime, la notifica ai fornitori applicabili e i testi rivolti all'utente.

## Invarianti richiesti a qualunque implementazione approvata

- Nessuna nuova operazione che dipende esclusivamente dal consenso ritirato può essere accettata o replicata dopo la revoca efficace; includere client/tab vecchi, richieste in volo, offline journal e backend con privilegi Admin.
- Le scelte non possono essere sovrascritte da snapshot stantii, merge guest→account, restore/import di backup, cambio dispositivo o autenticazione successiva.
- Distinguere rigorosamente stato locale `pending`, conferma autorevole server e failure; rifiutare il falso successo.
- Se la barriera server deve proteggere anche client obsoleti, implementarla in un confine verificabile dal server: il campo `UserData.legalConsent` è modificabile dal client e da solo non garantisce l'invariante.
- Revocare avvia, previa conferma informata, la cancellazione dei dati di tracciamento privi di altra base valida, incluse copie locali e pending journal. Il purge deve essere owner-scoped, recovery-safe, resistente a sessioni obsolete e testato; conservare solo le ricevute e le informazioni per cui sia giustificata una base e una durata specifiche.
- Informativa, documentazione di accountability, UI e comportamenti devono concordare. Se cambiano condizioni materiali, aggiornare `LEGAL_VERSIONS.privacy` e regressioni correlate.
- Non usare la revoca GA4 (`src/lib/analyticsConsent.ts`) come sostituto della revoca dei trattamenti salute: i due canali sono distinti.

## Regressioni CRITICAL da aggiungere **dopo** la decisione

1. Consenso con versione corretta vs assente/vecchio; rifiuto, revoca, ripresa e re-consenso, senza accesso improprio.
2. Revoca durante workout attivo, scrittura IndexedDB/journal, pending cloud write e lost acknowledgement.
3. Due tab e due dispositivi: una revoca non deve essere annullata da client obsoleti, offline o sessione riaperta.
4. Guest→account, logout→altro account, import/restore di backup con consenso precedente o snapshot vecchio.
5. Firestore Emulator: root, shard mensili e `sync_control` dopo revoca, inclusi test negativi; Admin API/cron verificati sul loro confine separato.
6. Errori di rete, storage non leggibile, token scaduto, App Check indisponibile, retry concorrenti e recovery.
7. Prova su browser/PWA iOS, Android e Desktop con temi/viewport pertinenti; test della accessibilità del flusso.
8. Nessun dato reale negli ambienti di test; `verify:m8` / CI canonica exact-SHA, review, merge, CI main e Production verificati separatamente.

## Implementazione candidata nella PR tecnica (non rilasciata)

La PR #301, ancora Draft, propone (non in Production):
- `health_consent_revocations/{uid}`, registro immutabile per client e leggibile solo dal proprietario;
- `isWritableOwner` in `firestore.rules`, per fermare le scritture anche da vecchie build; letture proprietario preservate per esercitare i diritti previsti;
- endpoint trusted `POST /api/health-consent-revocation`, autenticato con Firebase Auth e App Check limited-use consumato, con commit idempotente del marker;
- marker locale owner-scoped e barriera alle mutazioni/journal/device storage, con schermata di sospensione e retry senza falsa conferma cloud;
- rimozione del marker dal server prima di completare la cancellazione account, protetta dal lease già previsto;
- regressioni per Rules, replica, endpoint e lifecycle.

**Gate non chiuso:** la CI del candidato precedente e' verde, ma questo non prova il regime giuridico dei dati residui, le configurazioni esterne o il comportamento Production. Non attivare la funzione senza retention/cancellazione verificabili e review legale, runtime e UI. Un altro dispositivo che resta offline non può conoscere immediatamente una revoca registrata altrove: il server può bloccarne le successive scritture, ma la UI potrà adeguarsi soltanto alla riconnessione. Documentare esplicitamente questo limite nel contratto operativo.

## Gate di rilascio

**NON CHIUSO.** La versione di preparazione usa un gate chiuso nel codice per UI/API/cron (test sintetici separati): l'integrazione su `main` non implica l'abilitazione della revoca. Prima dell'attivazione con utenti reali:
- [ ] classificazione delle finalità e delle basi artt. 6/9 approvata da professionista competente;
- [x] decisione di prodotto: soluzione A (sospensione, export JSON facoltativo **prima** della conferma; informativa/diritti ed eliminazione account disponibili dopo);
- [x] specifica/implementazione candidate end-to-end per ospite, account, offline, multi-device e recovery, su PR Draft (non Production);
- [x] test automatici e regressioni sul candidato tecnico (10/10 check verdi sullo SHA citato; non equivalgono a una validazione runtime o legale);
- [ ] verifica Firestore Rules live, backend quando coinvolto e runtime PWA pertinente;
- [ ] informativa, registro, DPIA screening, retention e procedura diritti aggiornati e validati.

Rif.: `docs/compliance/health-consent-signoff.md`, `docs/compliance/data-subject-rights-procedure.md`, `docs/compliance/dpia-screening-template.md`, `docs/compliance/retention-schedule.md`, `docs/compliance/processing-record-template.md`, `.agents/rules/data-model-and-zod.md` e `.agents/rules/storage-and-sync.md`.
