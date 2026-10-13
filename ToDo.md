# ToDo — Ambiente Firebase di test per TheLogBook

> Stato: **DA FARE** — pianificazione, non implementazione.
> Ultimo aggiornamento: 13 ottobre 2026.
> Collegamento: [issue #375](https://github.com/gernotfound/logbook/issues/375) (collaudo autenticato del consenso salute).

## Obiettivo

Preparare un ambiente **separato da Production** per provare automaticamente il percorso completo della PWA con servizi Firebase reali: autenticazione, Firestore, App Check, backend trusted e recupero degli errori. I test non devono mai creare, modificare o cancellare dati dell'ambiente pubblico.

**Situazione di partenza:** GitHub Actions esegue già test Vitest, Playwright e Firebase Emulator. L'ambiente Firebase di test **non è ancora stato creato né verificato**; questi nuovi test integrativi si aggiungerebbero a quelli esistenti, senza sostituire `verify:m8`.

**Importante:** l'ambiente separato è un miglioramento consigliato, **non un prerequisito obbligatorio** per chiudere la #375. Per la #375 resta da attestare anche il collaudo autenticato reale della PWA Production con Firebase Auth e App Check.

## Attività da svolgere

### 1. Verifica preliminare e creazione del progetto

- [ ] Verificare su Firebase/Google Cloud quote, costi e disponibilità delle funzionalità necessarie, compreso reCAPTCHA Enterprise/App Check. Valutare il piano gratuito **Spark**: non assumere che tutti i servizi e scenari siano gratuiti.
- [ ] Creare un progetto Firebase distinto, con nome visualizzato suggerito **TheLogBook Test**. Il project ID effettivo va scelto in fase di creazione.
- [ ] Non collegarlo ai dati, agli utenti o alle credenziali del progetto Production `logbook-db-98cc4`.
- [ ] Non attivare Blaze, fatturazione o servizi a pagamento senza decisione esplicita del product owner.
- [ ] Registrare l'ambiente di test nella documentazione operativa quando esisterà davvero, distinguendo configurazione dichiarata e stato live verificato.

### 2. Configurazione Firebase e sicurezza

- [ ] Registrare una **Web App di test** e predisporre un origin/Hosting dedicato, distinto da `thelogbook.web.app`.
- [ ] Configurare Firebase Authentication per i metodi effettivamente necessari ai test (email/password, verifica email e, quando applicabile, Google); controllare domini autorizzati e redirect OAuth.
- [ ] Configurare Cloud Firestore di test, distribuendo le **stesse Security Rules e gli stessi indici approvati** per Production e verificandone lo stato live.
- [ ] Configurare Firebase App Check con un'integrazione **reCAPTCHA Enterprise dedicata**, controllando domini, site key, permessi e enforcement effettivo.
- [ ] Se servono token di debug App Check in CI, usarli **solo nell'ambiente di test**, custodirli come segreti GitHub, limitarne l'accesso e predisporre rotazione/revoca. Un token debug non dimostra da solo il funzionamento del provider reCAPTCHA Enterprise reale.
- [ ] Verificare in Google Cloud le restrizioni della chiave API browser, gli origin autorizzati e i privilegi minimi delle identità di servizio.

### 3. Backend trusted e separazione degli ambienti

- [ ] Predisporre un backend Vercel **dedicato ai test** oppure un isolamento equivalente verificato per le API `health-consent`, recovery e account deletion.
- [ ] Configurare Firebase Admin del backend di test affinché acceda **esclusivamente** al progetto Firebase Test; separare origini autorizzate, segreti, App Check e privilegi.
- [ ] Conservare tutte le credenziali server-only nel gestore di segreti appropriato; non inserirle nel repository o nel bundle frontend.
- [ ] Impedire ai workflow di test di distribuire codice/configurazioni su Firebase Hosting o Vercel Production. Rispettare il vincolo attuale sui deploy automatici dai branch non-`main`.

### 4. Automazione su GitHub Actions

- [ ] Aggiungere una suite Playwright integrata che esegua login reale e richieste reali verso Firebase Test e il backend di test, con account e dati sintetici isolati.
- [ ] Gestire segreti e credenziali CI con permessi minimi; non renderli disponibili a pull request non attendibili.
- [ ] Prevedere un avvio esplicito o un trigger controllato per i test integrativi; mantenere invariato il gate canonico `verify:m8` finché la nuova suite non sia stabile, verificabile e integrabile in sicurezza.
- [ ] Registrare esito, SHA del codice testato e diagnostica **sanitizzata**; eliminare i dati di prova senza toccare Production.

### 5. Scenari di regressione obbligatori

- [ ] Primo accesso autenticato: senza consenso salute server-side il cloud rifiuta letture e scritture private.
- [ ] Primo consenso valido: registrazione autorevole lato server e successivo accesso cloud consentito.
- [ ] Ospite → account: migrazione coerente, nessuna attribuzione automatica del consenso ospite all'account, nessuna perdita dell'archivio locale.
- [ ] Sessione Firebase autenticata con archivio ospite ancora attivo: logout e cancellazione account seguono il percorso corretto e non eliminano impropriamente i dati ospite.
- [ ] Revoca del consenso: sospensione delle funzioni fitness e blocco cloud, anche tra dispositivi/sessioni; export ed eliminazione account continuano a seguire il contratto previsto.
- [ ] Nuova accettazione: riattivazione soltanto dopo consenso esplicito, con revisione corretta; richieste vecchie o ritardate non possono ripristinare permessi.
- [ ] Offline, reload, rete interrotta, token scaduti, errori backend e ripresa: comportamento fail-closed e recupero senza perdita/corruzione dati.
- [ ] Verificare i percorsi App Check con token validi, assenti e non validi; effettuare **separatamente** uno smoke del provider reCAPTCHA Enterprise reale.
- [ ] Provare la cancellazione solo su **account sintetici di test**; verificare cleanup e isolamento dei dati.

### 6. Verifica finale e issue #375

- [ ] Eseguire la nuova suite su un commit esatto e controllare realmente i risultati; distinguere emulatori, Firebase Test e Production.
- [ ] Eseguire uno **smoke autenticato controllato in Production**, usando un account di prova e senza cancellazioni distruttive non autorizzate.
- [ ] Registrare in #375 le evidenze verificabili (SHA, run, servizi effettivi, risultati e limiti).
- [ ] Chiudere #375 **solo dopo** aver soddisfatto i criteri di accettazione dell'issue e risolto gli eventuali blocker residui.

## Responsabilità

- **Product owner:** autorizzare o creare il nuovo progetto Google/Firebase quando la console lo richiede; decidere soltanto su costi/fatturazione o altri vincoli di prodotto.
- **AI/sviluppo:** progettazione tecnica, isolamento, codice, test, workflow, documentazione, CI, review e verifiche disponibili.

Questo documento è una **lista di attività future**: la sua presenza nel repository non certifica che l'ambiente Firebase Test o i test Production siano stati configurati.
