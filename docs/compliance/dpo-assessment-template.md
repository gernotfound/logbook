# Valutazione dell'obbligo di designare un RPD/DPO — TheLogBook

> **Template di accountability, da compilare e validare prima del primo utente esterno.** Non è una nomina, una decisione legale approvata o un'attestazione di conformità. I dati che possono rivelare la salute **non rendono automaticamente obbligatoria** la designazione: verificare separatamente le condizioni dell'art. 37 GDPR, anche alla luce delle indicazioni del Garante e dell'EDPB. Se mancano prove decisive, l'esito rimane **da approfondire**, non «no».

## Ambito effettivo e documenti di riferimento

- **Modello dichiarato:** TheLogBook è attualmente un progetto amatoriale gestito da una persona fisica, con possibile apertura futura ad altri utenti maggiorenni. **Nessuna palestra o funzione coach/gym è attualmente prevista nel runtime come soggetto con accesso ai dati.** Un'offerta tramite palestre è uno scenario futuro, non un'attività già avviata.
- **Trattamenti da valutare:** misurazioni, alimentazione, allenamenti, sonno e annotazioni potenzialmente riferibili alla salute; account Firebase; dati locali guest; sincronizzazione cifrata, consenso, diritti, cancellazione e log tecnici dei fornitori. La cifratura non elimina di per sé la natura personale dei dati.
- **Monitoraggio:** il client corrente non include analytics comportamentali o invio automatico di diagnostica; ciò **non esclude** da solo il «monitoraggio regolare e sistematico» ai sensi dell'art. 37. Distinguere l'autotracciamento richiesto dall'utente dalle eventuali osservazioni, analisi o valutazioni sistematiche effettuate per finalità dell'operatore. Non presumere che calcoli fitness, frequenza di registrazione o dati di sensori costituiscano, da soli, monitoraggio dell'interessato da parte del titolare.
- **Stato delle prove:** numero effettivo di utenti e organizzazioni, durata/scala e configurazioni dei provider devono essere verificati e datati; dichiarazioni di prodotto, test e codice non sono un censimento live.
- **Perimetro della valutazione:** valutare l'obbligo di **ciascun soggetto** rispetto ai propri ruoli e trattamenti, come titolare e/o responsabile; non derivare automaticamente l'obbligo di TheLogBook da quello di Google, Vercel o di una futura palestra.

Fonti interne: [dossier e gate per utenti esterni](README.md), [ruoli GDPR](controller-role-decision.md), [registro trattamenti](processing-record-template.md), [screening DPIA](dpia-screening-template.md), [retention](retention-schedule.md), [fornitori](vendor-transfer-register.md), [informativa corrente](../../src/pages/PrivacyPolicy.tsx). Il presente template non sostituisce quei documenti e non ne duplica le decisioni.

## Soggetto, attività e fonti della verifica

| Campo | Da compilare |
|---|---|
| Soggetto valutato e forma effettiva | `[SOGGETTO/FORMA]` — non presumere una società o un contratto con palestra |
| Ruolo rispetto ai trattamenti esaminati | `[TITOLARE / RESPONSABILE / CONTITOLARE / DA VERIFICARE]`, con rinvio alla decisione sui ruoli |
| Attività principali e trattamenti concretamente eseguiti | `[ATTIVITÀ / FINALITÀ / FLUSSI / RIFERIMENTI]` |
| Ambito geografico e popolazione interessata | `[GEOGRAFIA / MAGGIORENNI / ALTRE CATEGORIE]` |
| Utenti/account realmente osservati e periodo | `[NUMERO / DATA / FONTE / NON VERIFICATO]` |
| Organizzazioni, palestre o clienti con accesso ai dati | `[NUMERO / TIPO DI ACCESSO / EVIDENZA]` |
| Data, baseline repository e fonti esterne consultate | `[DATA / MAIN_SHA / DOCUMENTI E PROVE LIVE]` |

## Verifica autonoma delle condizioni dell'art. 37 GDPR

Per ogni riga indicare **SÌ / NO / DA VERIFICARE**, la motivazione e un'evidenza datata. Non scegliere «NO» soltanto perché un'attività è amatoriale, gratuita o di piccole dimensioni.

| Condizione normativa | Esito | Motivazione ed evidenza |
|---|---|---|
| **Art. 37(1)(a):** il trattamento è effettuato da autorità/organismo pubblico (salva l'eccezione per autorità giurisdizionali nell'esercizio delle funzioni) | `[SÌ/NO/?]` | `[EVIDENZA]` |
| **Art. 37(1)(b):** monitoraggio *regolare e sistematico* degli interessati richiesto dalla natura/ambito/finalità del trattamento | `[SÌ/NO/?]` | `[CHI MONITORA, CHI È MONITORATO, FINALITÀ, MODALITÀ]` |
| **Art. 37(1)(b):** tale monitoraggio appartiene alle **attività principali** del soggetto | `[SÌ/NO/?]` | `[CORE ACTIVITY O FUNZIONE ACCESSORIA]` |
| **Art. 37(1)(b):** tale monitoraggio avviene **su larga scala** | `[SÌ/NO/?]` | `[VALUTAZIONE DELLA SCALA]` |
| **Art. 37(1)(c):** il trattamento di dati particolari art. 9 o dati art. 10 appartiene alle **attività principali** | `[SÌ/NO/?]` | `[CATEGORIE E NECESSITÀ PER IL SERVIZIO]` |
| **Art. 37(1)(c):** quel trattamento avviene **su larga scala** | `[SÌ/NO/?]` | `[VALUTAZIONE DELLA SCALA]` |
| **Art. 37(4):** ulteriori obblighi applicabili previsti da diritto UE/italiano | `[SÌ/NO/?]` | `[NORMA ED EVENTUALE AMBITO]` |

**Regola decisionale:** la lettera (a) opera autonomamente; la (b) richiede congiuntamente attività principali, monitoraggio regolare e sistematico e larga scala; la (c) richiede congiuntamente attività principali, categorie di dati pertinenti e larga scala. Verificare separatamente l'eventuale obbligo aggiuntivo del par. 4. Una condizione obbligatoria soddisfatta è sufficiente; criteri incerti non autorizzano conclusioni definitive.

### Analisi della larga scala e del monitoraggio

| Fattore | Misura o argomentazione verificabile |
|---|---|
| Numero di interessati (assoluto e, ove significativo, relativo alla popolazione di riferimento) | `[NUMERO / DENOMINATORE / DATA / FONTE]` |
| Volume di dati e varietà delle categorie, inclusi eventuali dati salute | `[TIPOLOGIE / VOLUMI / FONTE]` |
| Durata e continuità del trattamento | `[PERIODO / FREQUENZA / CONSERVAZIONE]` |
| Estensione geografica | `[TERRITORI / DISTRIBUZIONE / FONTE]` |
| Osservazione sistematica: attore, finalità, tracciamento nel tempo, automazione e destinatari dei risultati | `[FLUSSO E CONTROPROVE, ANCHE DI ASSENZA]` |

Non esiste qui una soglia numerica universale da applicare meccanicamente. Motivare la valutazione complessiva confrontando **tutti** i fattori; non confondere la valutazione DPO dell'art. 37 con lo screening DPIA dell'art. 35, che ha presupposti e decisione propri.

## Decisione documentata

- **RPD/DPO obbligatorio per il soggetto e le attività valutate:** `[SÌ / NO / DA APPROFONDIRE]`.
- **Condizione/i applicabile/i e ragionamento:** `[ARTICOLO / FATTI / CONTROEVIDENZE / CONCLUSIONE]`.
- **Elementi mancanti e verifiche da eseguire prima dell'approvazione:** `[AZIONE / RESPONSABILE / SCADENZA]`.
- **Se non obbligatorio, scelta sull'eventuale nomina volontaria:** `[NO / SÌ / DA VALUTARE]`.
- **Referente operativo per richieste privacy, distinto dal DPO:** `[RUOLO / CONTATTO / RESPONSABILITÀ]`. La presenza di un referente non equivale alla designazione di un RPD.
- **Decisione del soggetto responsabile, data ed evidenze:** `[RESPONSABILE / DATA / RIFERIMENTI]`.
- **Revisione professionale e approvazione:** `[NOME O RUOLO / DATA / ESITO]`.

**Gate pre-utenti esterni:** finché la valutazione e gli altri punti del [dossier compliance](README.md) non sono completati, permane il **NO-GO documentale**. Un esito «DPO non obbligatorio» non equivale a «DPIA non necessaria» né a conformità complessiva.

### Solo se un RPD/DPO viene designato, anche volontariamente

Verificare competenza, risorse, coinvolgimento tempestivo, autonomia e assenza di conflitti di interesse ai sensi degli artt. 37–39 GDPR. **Chi determina finalità e mezzi del trattamento non dovrebbe essere designato RPD dello stesso trattamento se ciò genera un conflitto**. Formalizzare incarico interno o contratto esterno; pubblicare i dati di contatto e comunicarli al Garante secondo l'art. 37(7), aggiornando anche l'informativa e il registro. La nomina volontaria comporta gli stessi requisiti sul ruolo: non chiamare «DPO» un semplice referente privacy.

## Eventi che impongono un riesame

Rivalutare prima di aprire il servizio a terzi e quando cambiano in modo significativo utenti, frequenza/scala del trattamento, categorie di dati, trattamenti automatizzati, dati da wearable, finalità, accesso di coach/palestre, eventuale modello B2B, ruoli, geografia o diritto applicabile. Annotare `[DATA DEL PROSSIMO CONTROLLO / EVENTO / RESPONSABILE]` e aggiornare registro, ruoli e DPIA se coinvolti.

## Fonti istituzionali

- [GDPR artt. 37–39 — EUR-Lex](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679).
- [Garante — FAQ RPD in ambito privato](https://www.garanteprivacy.it/faq-sul-responsabile-della-protezione-dei-dati-rpd-in-ambito-privato).
- [EDPB — Data Protection Officer, guida per piccole organizzazioni](https://www.edpb.europa.eu/sme/be-compliant/data-protection-officer_en).

Le fonti spiegano i criteri normativi, **non certificano** la situazione organizzativa, le metriche live o l'esito per TheLogBook.
