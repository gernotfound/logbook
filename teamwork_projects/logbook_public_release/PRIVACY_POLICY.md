# Informativa sulla privacy (Privacy policy)

**Ultimo aggiornamento:** 22 agosto 2026  
**Applicazione:** LogBook PWA  
**Riferimento normativo:** Regolamento Generale sulla Protezione dei Dati dell'Unione Europea (GDPR, Regolamento UE 2016/679) e D.Lgs. 196/2003 e s.m.i.

---

## 1. Premessa e principi generali

La presente informativa sulla privacy descrive in modo trasparente, chiaro e dettagliato le modalità e le finalità con cui l'applicazione **LogBook** ("Applicazione", "noi", "nostro") raccoglie, registra, organizza, conserva, consulta ed elabora i dati personali degli utenti ("Utente", "tu").

LogBook è sviluppata come Progressive Web Application (PWA) con architettura **Offline-first a 3 livelli** (Cloud Firestore, cache locale IndexedDB e memoria sincrona LocalStorage), progettata secondo i principi di **Privacy by Design** (protezione dei dati fin dalla progettazione) e **Privacy by Default** (impostazioni predefinite a massima tutela della riservatezza).

---

## 2. Titolare del trattamento e contatti

Il titolare del trattamento dei dati personali raccolti tramite l'applicazione LogBook è:
- **Titolare del trattamento:** [Nome e Cognome / Ragione Sociale dello Sviluppatore / Organizzazione]
- **Sede / Indirizzo:** [Indirizzo fisico / Città / Nazione]
- **Email di contatto e assistenza privacy:** `privacy@logbook.app`

Per qualsiasi chiarimento in merito al trattamento dei tuoi dati personali, o per esercitare i diritti riconosciuti dalla normativa comunitaria, puoi contattare il Titolare in qualsiasi momento all'indirizzo email sopra indicato o utilizzare le funzionalità di gestione e cancellazione presenti direttamente all'interno dell'applicazione.

---

## 3. Requisito inderogabile di maggiore età (≥ 18 anni)

L'utilizzo dell'applicazione LogBook è **strettamente ed esclusivamente riservato a persone fisiche che abbiano compiuto il diciottesimo (18°) anno di età**.

L'applicazione non è destinata a persone di età inferiore a 18 anni e non raccoglie intenzionalmente dati personali relativi a minori. Tale limitazione è adottata al fine di garantire la piena consapevolezza nella gestione dei dati particolari relativi alla salute e all'attività sportiva, escludendo la necessità di acquisire e verificare il consenso genitoriale ai sensi dell'Art. 8 del GDPR.

Qualora venisse accertata la registrazione o la presenza di dati personali appartenenti a un soggetto minore di 18 anni, l'account e tutti i dati a esso associati verranno **immediatamente, integralmente e permanentemente cancellati** da tutti i database cloud e dalle memorie del servizio.

---

## 4. Categorie di dati personali trattati

LogBook raccoglie ed elabora unicamente i dati personali strettamente necessari all'erogazione delle funzionalità di tracciamento atletico, diario nutrizionale e consultazione statistica.

### a) Dati di autenticazione e identificazione
- **Accesso con account Google (Google Sign-In):**
  - Indirizzo di posta elettronica (email).
  - Identificativo univoco dell'account Google (UID Firebase).
  - Nome visualizzato e URL dell'immagine del profilo (forniti da Google Identity Services).
- **Accesso in modalità locale (Guest):**
  - Nessun dato anagrafico o identificativo telematico viene trasmesso a server remoti. L'applicazione genera unicamente un identificativo di sessione locale memorizzato sul dispositivo dell'utente.

### b) Dati particolari relativi alla salute e biometrici (Art. 9 GDPR)
I dati inseriti volontariamente dall'utente per monitorare i propri parametri fisici, i progressi atletici e l'alimentazione costituiscono categorie particolari di dati personali ("dati relativi alla salute") ai sensi dell'Art. 9, par. 1, del GDPR:
- **Misurazioni corporee e biometriche:** Peso corporeo, altezza, data di nascita (utilizzata per il calcolo dell'età e del fabbisogno calorico), percentuale stimata di massa grassa, circonferenze corporee (collo, torace, spalle, bicipiti, vita, fianchi, cosce, polpacci) e orario della misurazione.
- **Parametri del sonno e del recupero:** Durata totale del sonno e ripartizione stimata delle fasi (sonno profondo, leggero, REM, veglia) inserite manualmente dall'utente.
- **Dati di allenamento e performance fisica:** Schede di allenamento personalizzate, storico degli esercizi, carichi sollevati (kg), numero di ripetizioni (reps), serie speciali (dropset, isometrie con durata in secondi), tempi di recupero cronometrati, durata delle sessioni, autovalutazioni soggettive dell'intensità (fatica, motivazione/umore, pompaggio muscolare) e segnalazione di dolori muscolari o articolari post-allenamento (DOMS / active pains).
- **Diario alimentare e nutrizionale:** Registrazione quotidiana dei pasti, apporto calorico complessivo (kcal), ripartizione dei macronutrienti (carboidrati, proteine, grassi), micronutrienti opzionali (fibre, sodio, zuccheri, grassi saturi, minerali), assunzione idrica giornaliera (litri d'acqua), elenco degli integratori alimentari assunti con relativi orari e dosaggi, e note testuali descrittive dei pasti.

### c) Dati tecnici di funzionamento e sicurezza
- **Indirizzo IP e metadati di connessione:** Elaborati in modo effimero e transitorio a livello di instradamento di rete dall'infrastruttura Google Firebase e dalla rete CDN di Vercel per la trasmissione sicura HTTPS/TLS e per i controlli di sicurezza anti-abuso. L'indirizzo IP non viene archiviato stabilmente nel database applicativo né associato al profilo dell'utente.
- **Informazioni sul dispositivo e sull'ambiente di esecuzione:** Tipologia di browser web, sistema operativo, stato di installazione dell'applicazione come Progressive Web App (PWA) e log tecnici di errore runtime.
- **Token di attestazione e integrità (Firebase App Check):** Token temporanei generati tramite Google reCAPTCHA v3 per verificare che le richieste provengano dalla PWA LogBook autentica e non da script automatizzati o bot malevoli.

### d) Dati statistici e diagnostici anonimi (previo consenso separato)
- Previo consenso opzionale dell'utente, l'applicazione raccoglie eventi analitici aggregati (es. apertura app, schede visualizzate, fasce di durata degli allenamenti, codici di errore standardizzati).
- **Garanzia assoluta di anonimato:** I dati analitici sono completamente privi di identificativi personali (nessun UID, nessuna email), privi di nomi di esercizi o alimenti, privi di carichi sollevati, privi di pesi o misure corporee e privi di note personali.

---

## 5. Basi giuridiche del trattamento (Art. 6 e Art. 9 GDPR)

Il trattamento dei tuoi dati personali si fonda esclusivamente sulle seguenti basi giuridiche:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MATRICE DELLE BASI GIURIDICHE DEL TRATTAMENTO                               │
├───────────────────────────────────┬─────────────────────────────────────────┤
│ Finalità del trattamento          │ Base giuridica applicabile (GDPR)       │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ Autenticazione, accesso e         │ Art. 6, par. 1, lett. b, GDPR           │
│ sincronizzazione cloud del diario │ (Esecuzione del contratto o di misure   │
│ tra dispositivi personali         │ precontrattuali richieste dall'utente)  │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ Tracciamento misurazioni corporee,│ Art. 6, par. 1, lett. a e               │
│ schede di allenamento, nutrizione,│ Art. 9, par. 2, lett. a, GDPR           │
│ integratori e metriche di salute  │ (Consenso esplicito e informato         │
│                                   │ manifestato dall'interessato)           │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ Telemetria statistica aggregata e │ Art. 6, par. 1, lett. a, GDPR           │
│ diagnostica tecnica anonima       │ (Consenso facoltativo e specifico       │
│                                   │ revocabile in qualsiasi momento)        │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ Sicurezza dell'infrastruttura,    │ Art. 6, par. 1, lett. f, GDPR           │
│ prevenzione abusi e bot           │ (Legittimo interesse del titolare alla  │
│ (App Check e controlli tecnici)   │ sicurezza e integrità del servizio)     │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

Il conferimento dei dati relativi alla salute è del tutto facoltativo; tuttavia, il mancato conferimento del consenso esplicito ai sensi dell'Art. 9(2)(a) del GDPR rende impossibile l'utilizzo delle funzionalità di diario dell'allenamento e della nutrizione.

---

## 6. Fornitori terzi, responsabili del trattamento e trasferimenti internazionali

I tuoi dati personali non vengono mai venduti, noleggiati, ceduti a terzi né utilizzati per finalità di profilazione commerciale o marketing comportamentale.

Il trattamento avviene avvalendosi esclusivamente dei seguenti fornitori tecnici, designati quali **Responsabili del Trattamento** (Data Processors) ai sensi dell'Art. 28 del GDPR:

1. **Google Firebase / Google Cloud (Google Ireland Limited / Google LLC):**
   - **Servizi utilizzati:** *Firebase Authentication* (gestione accessi sicuri), *Cloud Firestore* (database NoSQL cifrato per la persistenza cloud), *Firebase App Check* (verifica anti-abuso con reCAPTCHA v3) e *Firebase Analytics* (statistiche anonime aggregate, subordinatamente al consenso).
   - **Ubicazione dei server:** Unione Europea e Stati Uniti d'America.
   - **Garanzie di trasferimento extra-UE:** I trasferimenti verso Google LLC negli Stati Uniti sono legittimati dalla decisione di adeguatezza della Commissione Europea nell'ambito dell'**EU-U.S. Data Privacy Framework (DPF)** e dalla sottoscrizione delle **Clausole Contrattuali Standard (Standard Contractual Clauses - SCC)** approvate dalla Commissione Europea con decisione 2021/914/UE.
2. **Vercel Inc.:**
   - **Servizio utilizzato:** Hosting dell'applicazione web statica (PWA) e distribuzione globale tramite Content Delivery Network (CDN).
   - **Ubicazione dei server:** Unione Europea e Stati Uniti d'America.
   - **Garanzie di trasferimento extra-UE:** Regolato dalle Clausole Contrattuali Standard (SCC) incorporate nell'Accordo sul Trattamento dei Dati (DPA) di Vercel.

---

## 7. Modalità e tempi di conservazione dei dati (Data retention)

I dati personali vengono conservati per periodi determinati e proporzionati alle finalità per cui sono stati raccolti, escludendo categoricamente formule a tempo indeterminato:

| Categoria di dati | Periodo di conservazione | Criterio di cancellazione / oblio |
|---|---|---|
| **Dati dell'account (email, profilo, UID)** | Per l'intera durata di attività dell'account utente. | Cancellazione immediata su richiesta dell'utente tramite la funzione in-app *"Elimina account e dati"*. Cancellazione automatica dopo **24 mesi di inattività continuativa** (previo avviso via email). |
| **Dati di allenamento, nutrizione e biometria** | Per l'intera durata di attività dell'account utente. | Cancellazione immediata a cascata su tutte le subcollection Firestore (`history_months`, `nutrition_months`) all'eliminazione dell'account. |
| **Dati in cache locale (IndexedDB / LocalStorage)** | Fino all'eliminazione manuale da parte dell'utente. | Rimossi all'effettuazione del logout, alla cancellazione dei dati di navigazione del browser o alla disinstallazione della PWA. |
| **Token di sicurezza App Check** | Durata massima di **1 ora (3.600 secondi)**. | Scadenza e sovrascrittura automatica in memoria volatile. |
| **Dati statistici e diagnostici anonimi** | Periodo massimo di **14 mesi**. | Cancellazione automatica e definitiva dai sistemi di aggregazione analitica. |

---

## 8. Memoria tecnica locale e funzionamento offline-first

LogBook adotta un'architettura **Offline-first a 3 livelli** per consentire l'utilizzo completo dell'applicazione anche in assenza di connessione internet:

1. **IndexedDB (`idb-keyval`):**
   - Memorizza la copia di sicurezza locale dell'intero archivio utente (`logbook_cached_user_data`) e la cache del catalogo globale degli esercizi e alimenti (`logbook_cached_global_catalog`).
   - Supera i limiti di quota di 5 MB di LocalStorage, garantendo che i dati non vadano mai persi durante sessioni prolungate.
2. **LocalStorage (Storage sincrono):**
   - Memorizza lo stato della sessione di allenamento in corso (`logbook_local_workout`) per prevenire la perdita di serie e carichi qualora il sistema operativo sospenda il browser in background (`visibilitychange`).
   - Memorizza preferenze di interfaccia (scheda attiva), stato della modalità ospite (`logbook_is_guest`) e stato del consenso analitico (`logbook_analytics_consent`).

Queste tecnologie operano esclusivamente come **supporti tecnici essenziali al servizio** (assimilabili a cookie tecnici) e non contengono alcun tracciatore di terze parti per finalità pubblicitarie o di profilazione.

---

## 9. Diritti dell'interessato (GDPR Artt. 15–22)

In qualità di interessato, il Regolamento UE 2016/679 ti garantisce l'esercizio dei seguenti diritti in qualsiasi momento e a titolo gratuito:

1. **Diritto di accesso e portabilità dei dati (Artt. 15 e 20 GDPR):**
   - Puoi visualizzare tutti i tuoi dati direttamente nelle schermate dell'applicazione.
   - Puoi esportare l'intero archivio storico dei tuoi allenamenti e delle tue misurazioni nutrizionali in formato standard aperto e interoperabile premendo il pulsante *"Esporta dati (CSV)"* nelle Impostazioni. L'applicazione genera due file CSV conformi con codifica UTF-8 BOM (`allenamenti.csv` e `misurazioni.csv`), direttamente fruibili con Microsoft Excel, Google Fogli o altri software di analisi.
2. **Diritto di rettifica (Art. 16 GDPR):**
   - Puoi aggiornare, modificare o correggere in tempo reale qualsiasi dato personale, biometrico, esercizio o registrazione alimentare direttamente dalle rispettive schermate dell'app.
3. **Diritto alla cancellazione / Diritto all'oblio (Art. 17 GDPR):**
   - Puoi eliminare definitivamente e irrevocabilmente l'intero account e tutti i dati a esso associati accedendo a *Impostazioni $\rightarrow$ Zona pericolosa* e selezionando *"Elimina account e dati"*.
   - Il sistema esegue una cancellazione a cascata che rimuove il documento radice `users/{uid}`, tutte le registrazioni nelle subcollection `history_months` e `nutrition_months`, svuota la cache locale del dispositivo e cancella l'utenza da Firebase Authentication.
4. **Diritto di revoca del consenso (Art. 7, par. 3, GDPR):**
   - Puoi revocare in qualsiasi momento il consenso al trattamento dei dati sanitari (comportando la cessazione del servizio e la chiusura dell'account).
   - Puoi revocare in qualsiasi momento il consenso alla telemetria anonima agendo sul toggle *"Analitica e diagnostica"* nelle Impostazioni, con efficacia immediata e senza alcuna conseguenza sulla piena fruibilità dell'app.
5. **Diritto di opposizione e limitazione del trattamento (Artt. 18 e 21 GDPR):**
   - Puoi richiedere la limitazione del trattamento o opporti allo stesso per motivi legittimi contattando il Titolare via email.
6. **Diritto di proporre reclamo all'Autorità di controllo (Art. 77 GDPR):**
   - Qualora ritenessi che il trattamento dei tuoi dati personali avvenga in violazione del GDPR o della normativa nazionale, hai il diritto di proporre reclamo formale all'Autorità di controllo competente:
     - **Garante per la Protezione dei Dati Personali**
     - Indirizzo: Piazza Venezia n. 11, 00187 Roma (Italia)
     - Sito web: [www.garanteprivacy.it](https://www.garanteprivacy.it)
     - Centralino: (+39) 06.696771 — Email: `protocollo@gpdp.it`

---

## 10. Misure di sicurezza tecniche e organizzative

LogBook adotta rigorose misure di sicurezza tecniche e organizzative per proteggere i dati personali da distruzione accidentale o illecita, perdita, alterazione, divulgazione non autorizzata o accesso indebito:

- **Crittografia end-to-end in transito:** Tutte le comunicazioni tra il browser dell'utente e i server cloud avvengono su canali cifrati con protocollo HTTPS e crittografia TLS 1.3.
- **Crittografia dei dati a riposo (Encryption at rest):** Tutti i dati memorizzati nei database cloud di Cloud Firestore sono automaticamente cifrati a riposo tramite standard crittografici avanzati (AES-256 gestito da Google Cloud).
- **Regole di sicurezza server-side a zero trust (Firestore Security Rules):** Le regole di sicurezza di Firestore verificano l'identità crittografica del richiedente (`request.auth.uid == userId`) su ogni singola operazione, impedendo categoricamente l'accesso o la lettura dei dati altrui.
- **Protezione anti-abuso con Firebase App Check:** L'infrastruttura è protetta da Firebase App Check con reCAPTCHA v3, bloccando tentativi di scraping, script automatizzati o chiamate non autorizzate alle API del database.
- **Isolamento della memoria locale:** IndexedDB e LocalStorage operano nel contesto isolato della Same-Origin Policy (SOP) del browser web, impedendo l'accesso ai dati da parte di altri siti web o applicazioni terze.

---

## 11. Collocazione in-app, gestione del consenso e revoca

L'informativa sulla privacy è resa costantemente accessibile e visibile all'utente attraverso due punti strategici dell'interfaccia:
1. **Schermata di accesso (Welcome / Login):** Collegamento ipertestuale visibile prima dell'autenticazione con Google o dell'avvio in modalità Guest, con richiesta di presa visione e accettazione delle condizioni e del consenso al trattamento dei dati sanitari (Art. 9 GDPR).
2. **Schermata Impostazioni (Settings View):** Sezione dedicata *"Informativa sulla privacy"* che consente la consultazione integrale del testo in qualsiasi momento.
3. **Pannello di controllo della telemetria:** In *Impostazioni $\rightarrow$ Privacy e diagnostica*, è presente un controllo a levetta (toggle) che consente di abilitare o disabilitare la condivisione anonima della diagnostica in tempo reale.

---

## 12. Modifiche e aggiornamenti dell'informativa

Il Titolare del trattamento si riserva il diritto di apportare modifiche o aggiornamenti alla presente informativa sulla privacy in conseguenza di modifiche legislative, evoluzioni giurisprudenziali o introduzione di nuove funzionalità tecniche nell'applicazione.

In caso di modifiche sostanziali che incidano sui diritti dell'utente o sulle modalità di trattamento dei dati particolari, LogBook provvederà a informare tempestivamente gli utenti tramite un avviso ben visibile all'apertura dell'applicazione, richiedendo, ove necessario, il rinnovo del consenso prima dell'applicazione delle nuove condizioni.
