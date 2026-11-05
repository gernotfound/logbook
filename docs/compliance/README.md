# TheLogBook — compliance per i primi utenti esterni e per un eventuale futuro pilot B2B

> Stato: struttura operativa per eventuali utenti esterni, da completare e far revisionare prima del loro primo utilizzo reale.
> Ultimo aggiornamento tecnico: 5 novembre 2026.
> Questo pacchetto non certifica conformità GDPR e non sostituisce consulenza legale, privacy o fiscale.
>
> Navigazione: [indice documentazione](../README.md). I contratti AI restano in [`AGENTS.md`](../../AGENTS.md) e i relativi contratti specialistici: [Consenso salute](../../.agents/rules/health-consent.md), [Portabilità](../../.agents/rules/backup-and-portability.md), [Ciclo account](../../.agents/rules/account-lifecycle.md), [Cifratura](../../.agents/rules/secure-storage.md) e [Telemetria](../../.agents/rules/telemetry-and-privacy.md).

## Obiettivo

Questa cartella raccoglie i documenti operativi che servono per trasformare le scelte tecniche di TheLogBook in un processo dimostrabile: registro dei trattamenti, screening DPIA, retention, incident response, fornitori/trasferimenti, misure tecniche e organizzative, gestione dei diritti e documentazione B2B.

La fonte di verità tecnica resta il repository corrente. Le configurazioni esterne — Firebase/Google Cloud, Vercel, GitHub e relativi account amministrativi — devono essere verificate direttamente prima del pilot e non vanno dedotte da questi template.

## Modello di utilizzo deciso dal product owner — 5 novembre 2026

TheLogBook è, allo stato dichiarato, un **progetto amatoriale**, non erogato attraverso un'impresa o società. Il product owner **intende permettere anche ad altre persone di creare un account e registrare i propri dati**, senza che ciò implichi una distribuzione commerciale o un accordo con palestre. Questa è una decisione per l'utilizzo previsto, **non una prova che altri utenti siano già iscritti**. Non attribuire al progetto ragione sociale, partita IVA, forma societaria, contratti palestra o finalità commerciali inesistenti. Le sezioni B2B sotto descrivono **uno scenario futuro**.

La natura amatoriale o gratuita **non determina un'esenzione GDPR**: l'art. 2, par. 2, lett. c e il considerando 18 delimitano l'eccezione alle attività esclusivamente personali o domestiche. **Dato il previsto accesso di utenti esterni, non assumere l'applicabilità di tale eccezione per erogare la PWA**. Una persona fisica può essere titolare del trattamento anche senza società, ma identità, recapiti, basi giuridiche, misure e obblighi applicabili devono essere determinati prima di acquisire dati reali di altri utenti. Riferimenti: [Regolamento UE 2016/679, art. 2 e considerando 18](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679) e [Commissione europea — ambito di applicazione del GDPR](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en).

**Decisione di prodotto presa:** consentire in prospettiva la registrazione di persone diverse dall'autore, in una fase amatoriale senza accordo con palestre. **Stato di rilascio per utenti esterni: NO-GO** fino alla chiusura documentata dei punti del gate seguente, incluse verifiche legali e tecniche. Questa decisione non costituisce autorizzazione a iscrivere utenti reali né cambia configurazioni, accessi, registrazioni, consent gate o deployment Production.

## Gate legale prima del primo utilizzatore esterno

**Stato: NON PRONTO per trattare dati reali di terzi.** Questo gate riguarda anche un pilot gratuito con una sola persona e non nasce soltanto al momento della vendita a una palestra. L'uso personale del product owner non dimostra che siano soddisfatti gli obblighi applicabili a un servizio offerto ad altre persone.

La PWA gestisce dati potenzialmente rientranti nelle categorie particolari dell'art. 9 GDPR. Il codice prova alcuni comportamenti tecnici, ma non determina l'identità del titolare, le basi giuridiche, le condizioni di conservazione dopo la revoca o gli obblighi contrattuali. Non rimuovere i segnaposto pubblici sostituendoli con dati presunti e non definire una policy legale sulla sola base dei test.

| Blocco | Fonte interna | Evidenza necessaria per la chiusura |
|---|---|---|
| Identità e recapiti del soggetto che eroga il servizio | `src/pages/PrivacyPolicy.tsx`, `src/pages/TermsAndConditions.tsx` | Denominazione/forma effettiva, indirizzo, contatto privacy funzionante e ruolo del titolare verificati |
| Finalità e basi giuridiche per ogni trattamento, inclusi dati salute | `processing-record-template.md`, `health-consent-release-gate.md` | Valutazione documentata artt. 6 e 9, consenso esplicito dove necessario e testi pubblici coerenti, validati da professionista competente |
| Dati trattenuti dopo revoca del consenso | `retention-schedule.md`, `data-subject-rights-procedure.md` | Per ogni categoria: finalità residua, eventuale base autonoma già individuata, termine e meccanismo di cancellazione; se manca una base valida, definire adeguamento effettivo del comportamento tecnico |
| Periodi di conservazione, log e copie dei fornitori | `retention-schedule.md`, `vendor-transfer-register.md` | Durate reali, configurazioni, eventuali backup, localizzazioni e limiti delle cancellazioni verificati nei provider |
| Ruoli, fornitori e trasferimenti internazionali | `controller-role-decision.md`, `vendor-transfer-register.md` | Identificazione dei ruoli fattuali, DPA quando richiesti, elenco fornitori e verifica dei meccanismi applicabili ai trasferimenti |
| Valutazioni e procedure organizzative | `dpia-screening-template.md`, `dpo-assessment-template.md`, `incident-breach-runbook.md` | Screening DPIA e DPO documentati, eventuali ulteriori adempimenti eseguiti, canale diritti e gestione incidenti assegnati |
| Consegna tecnica a utenti reali | `first-gym-b2b-checklist.md`, `../operations/e2e-reliability.md` | Collaudi mirati autorizzati, esiti Production separati dai test, decisione di rilascio documentata |

**Regola di chiusura:** solo dopo questi accertamenti aggiornare l'informativa e i termini effettivamente mostrati nell'app, adeguare il codice se la policy approvata diverge dal runtime e incrementare le versioni applicabili in `src/lib/legalVersions.ts`. Un mero cambio di testo non può sanare una conservazione non giustificata o una cancellazione tecnicamente assente. La decisione GO/NO-GO per terzi va registrata con chi l'ha approvata e le prove pertinenti.

**Fonti istituzionali per la revisione:** [GDPR, artt. 6, 7, 9, 13, 17 e 35 (EUR-Lex)](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679), [Garante — informativa agli interessati](https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/8981258), [EDPB — Linee guida 05/2020 sul consenso](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_it).

## Scenario B2B futuro — non parte dell'attuale utilizzo amatoriale

Le seguenti assunzioni sono riferite soltanto all'eventuale futura distribuzione tramite palestre; non descrivono una collaborazione o un rapporto commerciale oggi esistente.

- Se previsto in futuro, il pagamento palestra → fornitore avviene tramite rapporto commerciale esterno alla PWA.
- La palestra rende TheLogBook disponibile agli iscritti ma, nell'architettura attuale, non dispone di ruoli gym/coach/admin e non accede ai dati TheLogBook degli utenti.
- TheLogBook resta destinato a maggiorenni.
- Google Analytics 4/Firebase Analytics è dismesso: integrazione e preferenza rimosse dal client, Firebase scollegato dalla proprietà e configurazione GitHub Analytics ritirata. Restano operativi i servizi Firebase necessari al funzionamento.
- Vercel Analytics e Speed Insights sono ritirati dal frontend Production.
- Il client non invia automaticamente segnalazioni diagnostiche a fornitori esterni: i controlli di integrità e recupero restano nella PWA; i log tecnici Firebase/Vercel costituiscono trattamenti separati.

Queste assunzioni devono essere riconfermate nella documentazione firmata; se cambiano, vanno rivalutati ruoli privacy, contratti, informativa e DPIA.

## Documenti

| File | Scopo | Stato prima del pilot |
|---|---|---|
| [`processing-record-template.md`](processing-record-template.md) | Registro trattamenti / RoPA | Compilare e firmare |
| [`controller-role-decision.md`](controller-role-decision.md) | Decisione documentata sui ruoli provider/palestra | Validare professionalmente |
| [`dpia-screening-template.md`](dpia-screening-template.md) | Screening Art. 35 e decisione DPIA | Completare e firmare |
| [`retention-schedule.md`](retention-schedule.md) | Durate, trigger di cancellazione e verifiche | Approvare e allineare al runtime |
| [`incident-breach-runbook.md`](incident-breach-runbook.md) | Gestione incidenti e data breach | Assegnare contatti e provare il flusso |
| [`vendor-transfer-register.md`](vendor-transfer-register.md) | Fornitori, subprocessori e trasferimenti | Verificare contratti e localizzazioni |
| [`technical-organizational-measures.md`](technical-organizational-measures.md) | TOM / misure Art. 32 | Verificare elementi esterni |
| [`dpo-assessment-template.md`](dpo-assessment-template.md) | Valutazione obbligo DPO | Compilare e riesaminare su aumento scala |
| [`data-subject-rights-procedure.md`](data-subject-rights-procedure.md) | Accesso, rettifica, portabilità, cancellazione, revoche | Assegnare canale privacy |
| [`health-consent-release-gate.md`](health-consent-release-gate.md) | Specifica CRITICAL soluzione A approvata dal product owner; revoca salute e percorso di sospensione | Implementazione e regressioni integrate con PR #366; collaudo autenticato multi-dispositivo e validazione legale pre-pilot aperti |
| [`health-consent-technical-protocol.md`](health-consent-technical-protocol.md) | Protocollo tecnico revoca/riaccettazione e fence | Implementazione descritta; smoke autenticato multi-dispositivo e gate legale pre-pilot aperti |
| [`support-sla-policy-template.md`](support-sla-policy-template.md) | Supporto, severità e impegni di servizio | Definire solo promesse sostenibili |
| [`exit-deletion-policy-template.md`](exit-deletion-policy-template.md) | Cessazione B2B e dati | Allineare al ruolo privacy |
| [`gym-privacy-instructions-template.md`](gym-privacy-instructions-template.md) | Istruzioni operative alla palestra | Consegnare/adattare al pilot |
| [`first-gym-b2b-checklist.md`](first-gym-b2b-checklist.md) | Gate di consegna alla palestra | Chiudere tutti i blocker |
| [`saas-agreement-template.md`](saas-agreement-template.md) | Struttura contratto commerciale | Revisione legale + dati reali |
| [`commercial-schedule-template.md`](commercial-schedule-template.md) | Allegato economico separato | Compilare con dati commerciali |
| [`dpa-art28-template.md`](dpa-art28-template.md) | Allegato Art. 28 condizionale | Usare solo se il ruolo processor è confermato |

## Placeholder standard

Non inserire dati personali o fiscali reali finché non serve alla release contrattuale.

- `[PROVIDER_LEGAL_NAME]`
- `[PROVIDER_LEGAL_FORM]`
- `[PROVIDER_ADDRESS]`
- `[PRIVACY_EMAIL]`
- `[SUPPORT_EMAIL]`
- `[TAX_DETAILS]`
- `[GYM_LEGAL_NAME]`
- `[GYM_ADDRESS]`
- `[FEE]`
- `[TERM]`
- `[NOTICE_PERIOD]`
- `[SUPPORT_COMMITMENT]`

## Regola di aggiornamento

Quando cambia un flusso dati, un fornitore, una base giuridica, una retention, un accesso amministrativo o una funzione di condivisione, aggiornare almeno il registro trattamenti, il registro fornitori/trasferimenti, lo screening DPIA e la documentazione pubblica/contrattuale interessata.

## Riferimenti normativi da usare nella revisione

- GDPR: artt. 5, 6, 9, 12–22, 24, 25, 28, 30, 32–35, 44 e seguenti.
- Linee guida EDPB 07/2020 sui concetti di titolare e responsabile.
- Indicazioni del Garante italiano su registro dei trattamenti, DPIA e data breach.

Verificare sempre le fonti ufficiali correnti prima della firma.
