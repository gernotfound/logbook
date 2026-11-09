# TheLogBook — compliance per l'accesso di utenti esterni

> Stato: struttura operativa per eventuali utenti esterni, da completare e far revisionare prima del loro primo utilizzo reale.
> Ultimo aggiornamento tecnico del dossier sulla revoca: 6 novembre 2026 (PR #826/#829 integrate); validazione privacy pre-utenti esterni ancora aperta.
> Questo pacchetto non certifica conformità GDPR e non sostituisce consulenza legale, privacy o fiscale.
>
> Navigazione: [indice documentazione](../README.md). I contratti AI restano in [`AGENTS.md`](../../AGENTS.md) e i relativi contratti specialistici: [Consenso salute](../../.agents/rules/health-consent.md), [Portabilità](../../.agents/rules/backup-and-portability.md), [Ciclo account](../../.agents/rules/account-lifecycle.md), [Cifratura](../../.agents/rules/secure-storage.md) e [Telemetria](../../.agents/rules/telemetry-and-privacy.md).

## Obiettivo

Questa cartella raccoglie i documenti operativi che servono per trasformare le scelte tecniche di TheLogBook in un processo dimostrabile: registro dei trattamenti, screening DPIA, retention, incident response, fornitori/trasferimenti, misure tecniche e organizzative, gestione dei diritti.

La fonte di verità tecnica resta il repository corrente. Le configurazioni esterne — Firebase/Google Cloud, Vercel, GitHub e relativi account amministrativi — devono essere verificate direttamente prima dell'apertura a utenti esterni e non vanno dedotte da questi template.

## Modello di utilizzo deciso dal product owner — 5 novembre 2026

TheLogBook è, allo stato dichiarato, un **progetto amatoriale**, non erogato attraverso un'impresa o società. Il product owner **intende permettere anche ad altre persone di creare un account e registrare i propri dati**, senza un modello di distribuzione commerciale. Questa è una decisione per l'utilizzo previsto, **non una prova che altri utenti siano già iscritti**. Non attribuire al progetto ragione sociale, partita IVA, forma societaria o finalità commerciali inesistenti.

**Identità e contatto comunicati dal product owner:** Gerardo Califano (persona fisica), thelogbook.privacy@gmail.com. **Il product owner ha confermato il 5 novembre 2026 che la casella funziona**; questa è un'attestazione dell'interessato, non un test indipendente né una verifica del suo monitoraggio continuativo. Rimane da valutare un recapito postale appropriato, se richiesto per il modello di comunicazione adottato.

La natura amatoriale o gratuita **non determina un'esenzione GDPR**: l'art. 2, par. 2, lett. c e il considerando 18 delimitano l'eccezione alle attività esclusivamente personali o domestiche. **Dato il previsto accesso di utenti esterni, non assumere l'applicabilità di tale eccezione per erogare la PWA**. Una persona fisica può essere titolare del trattamento anche senza società, ma identità, recapiti, basi giuridiche, misure e obblighi applicabili devono essere determinati prima di acquisire dati reali di altri utenti. Riferimenti: [Regolamento UE 2016/679, art. 2 e considerando 18](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679) e [Commissione europea — ambito di applicazione del GDPR](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en).

**Decisione di prodotto presa:** consentire in prospettiva la registrazione di persone diverse dall'autore, in una fase amatoriale gratuita. **Stato di rilascio per utenti esterni: NO-GO** fino alla chiusura documentata dei punti del gate seguente, incluse verifiche legali e tecniche. Questa decisione non costituisce autorizzazione a iscrivere utenti reali né cambia configurazioni, accessi, registrazioni, consent gate o deployment Production.

**Distinzione operativa:** NO-GO è una decisione di rilascio/compliance, **non una prova che la registrazione sia tecnicamente disabilitata** o che il sito non sia raggiungibile. La presenza dei moduli di registrazione, dei testi legali nell'app o di una release Production non autorizza né attesta il trattamento di dati reali di utenti esterni. Prima di dichiarare GO occorre verificare separatamente l'esposizione effettiva della registrazione, la documentazione approvata e i controlli del runtime; non usare utenti reali per collaudi distruttivi.

## Gate legale prima del primo utilizzatore esterno

**Stato: NON PRONTO per trattare dati reali di terzi.** Questo gate riguarda anche una fase gratuita con una sola persona esterna. L'uso personale del product owner non dimostra che siano soddisfatti gli obblighi applicabili a un servizio offerto ad altre persone.

La PWA gestisce dati potenzialmente rientranti nelle categorie particolari dell'art. 9 GDPR. Il codice prova alcuni comportamenti tecnici; l'identità del titolare e il recapito email sono ora dichiarati dal product owner, mentre le basi giuridiche e la conservazione delle **prove residue** dopo revoca, nonché gli obblighi contrattuali, restano da accertare. La cancellazione automatica degli archivi fitness alla revoca trusted è già implementata, ma il collaudo autenticato completo non è attestato. Non rimuovere i segnaposto pubblici sostituendoli con dati presunti e non definire una policy legale sulla sola base dei test.

| Blocco | Fonte interna | Evidenza necessaria per la chiusura |
|---|---|---|
| Identità e recapiti del soggetto che eroga il servizio | `src/pages/PrivacyPolicy.tsx`, `src/pages/TermsAndConditions.tsx` | Il titolare persona fisica è identificato dal product owner come **Gerardo Califano**, con contatto dichiarato **thelogbook.privacy@gmail.com**. Ricezione email confermata dal product owner il 5 novembre 2026; restano da verificare monitoraggio operativo, eventuale recapito postale appropriato, ruolo e informazioni obbligatorie |
| Finalità e basi giuridiche per ogni trattamento, inclusi dati salute | `processing-record-template.md`, `health-consent-release-gate.md`, `src/pages/PrivacyPolicy.tsx` | L'informativa nel codice **indica già** art. 6(1)(b) per il servizio e art. 9(2)(a) per i dati salute; la presenza di queste affermazioni non è una validazione legale. Documentare e far revisionare per ogni finalità la base Art. 6, la condizione Art. 9 e la libertà del consenso, poi allineare i testi pubblici e le versioni legali |
| Dati trattenuti dopo revoca del consenso | `retention-schedule.md`, `data-subject-rights-procedure.md` | Erasure automatica dei dati applicativi integrata; verificare in runtime il completamento e giustificare separatamente marker, ricevute, Auth e copie dei fornitori con base, durata, accessi e meccanismo di cancellazione |
| Periodi di conservazione, log e copie dei fornitori | `retention-schedule.md`, `vendor-transfer-register.md` | Durate reali, configurazioni, eventuali backup, localizzazioni e limiti delle cancellazioni verificati nei provider; non assimilare la retention tecnica delle ricevute alla giustificazione giuridica |
| Ruoli, fornitori e trasferimenti internazionali | `controller-role-decision.md`, `vendor-transfer-register.md` | Identificazione dei ruoli fattuali, DPA quando richiesti, elenco fornitori e verifica dei meccanismi applicabili ai trasferimenti |
| Valutazioni e procedure organizzative | `dpia-screening-template.md`, `dpo-assessment-template.md`, `incident-breach-runbook.md` | Screening DPIA e DPO documentati, eventuali ulteriori adempimenti eseguiti, canale diritti e gestione incidenti assegnati |
| Consegna tecnica a utenti reali (beta gratuita) | `health-consent-release-gate.md`, `technical-organizational-measures.md`, `../operations/e2e-reliability.md` | Collaudi autenticati autorizzati con dati sintetici, evidenze Production distinte dalla CI e decisione GO documentata |
| Possibile cancellazione per inattività | `retention-schedule.md`, `src/lib/accountActivity.ts`, `api/account-activity.ts`, `api/account-deletion-cron.ts` | Codice di tracciamento/accodamento presente ma subordinato a feature flag client e server, con scheduler disabilitato di default; l'effettiva configurazione Production non è attestata da questi file. Prima di qualsiasi attivazione: revisione legale della soglia di 12 mesi senza email, aggiornamento informativa/versioni, valutazione del rischio per chi resta offline e collaudi fail-closed ([issue #835](https://github.com/gernotfound/logbook/issues/835)) |

**Regola di chiusura:** i segnaposto e le annotazioni di lavoro restano nella documentazione interna, non nei testi pubblicati nella PWA. I componenti pubblici attuali contengono già identità del titolare, contatto e dichiarazioni sulle basi giuridiche: **la pubblicazione non equivale all'approvazione professionale**. Prima dei primi utenti esterni completare e validare tutte le informazioni mancanti, adeguare il comportamento tecnico dove necessario e incrementare le versioni legali applicabili in `src/lib/legalVersions.ts` se cambiano i testi. La rimozione dei segnaposto pubblici non rende conforme il trattamento né sana una retention priva di giustificazione. La decisione GO/NO-GO per terzi va registrata con chi l'ha approvata e le prove pertinenti. Per la revoca vedi [issue #824](https://github.com/gernotfound/logbook/issues/824).

**Fonti istituzionali per la revisione:** [GDPR, artt. 6, 7, 9, 13, 17 e 35 (EUR-Lex)](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679), [Garante — informativa agli interessati](https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/8981258), [EDPB — Linee guida 05/2020 sul consenso](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_it).

## Documenti

| File | Scopo | Stato prima dell'apertura a utenti esterni |
|---|---|---|
| [`processing-record-template.md`](processing-record-template.md) | Registro trattamenti / RoPA | Compilare e firmare |
| [`controller-role-decision.md`](controller-role-decision.md) | Valutazione del ruolo del gestore e dei fornitori | Validare professionalmente |
| [`dpia-screening-template.md`](dpia-screening-template.md) | Screening Art. 35 e decisione DPIA | Completare e firmare |
| [`retention-schedule.md`](retention-schedule.md) | Durate, trigger di cancellazione e verifiche | Approvare e allineare al runtime |
| [`incident-breach-runbook.md`](incident-breach-runbook.md) | Gestione incidenti e data breach | Assegnare contatti e provare il flusso |
| [`vendor-transfer-register.md`](vendor-transfer-register.md) | Fornitori, subprocessori e trasferimenti | Verificare contratti e localizzazioni |
| [`technical-organizational-measures.md`](technical-organizational-measures.md) | TOM / misure Art. 32 | Verificare elementi esterni |
| [`dpo-assessment-template.md`](dpo-assessment-template.md) | Valutazione obbligo DPO | Compilare e riesaminare su aumento scala |
| [`data-subject-rights-procedure.md`](data-subject-rights-procedure.md) | Accesso, rettifica, portabilità, cancellazione, revoche | Assegnare canale privacy |
| [`health-consent-release-gate.md`](health-consent-release-gate.md) | Decisione corrente revoca → cancellazione automatica dati fitness, distinta da account deletion | PR #826/#829 integrate; collaudo autenticato multi-dispositivo e validazione legale pre-pilot aperti |
| [`health-consent-technical-protocol.md`](health-consent-technical-protocol.md) | Protocollo tecnico revoca/riaccettazione e fence | Implementazione descritta; smoke autenticato multi-dispositivo e gate legale pre-pilot aperti |

## Regola di aggiornamento

Quando cambia un flusso dati, un fornitore, una base giuridica, una retention, un accesso amministrativo o una funzione di condivisione, aggiornare almeno il registro trattamenti, il registro fornitori/trasferimenti, lo screening DPIA e la documentazione pubblica interessata.

## Riferimenti normativi da usare nella revisione

- GDPR: artt. 5, 6, 9, 12–22, 24, 25, 28, 30, 32–35, 44 e seguenti.
- Linee guida EDPB 07/2020 sui concetti di titolare e responsabile.
- Indicazioni del Garante italiano su registro dei trattamenti, DPIA e data breach.

Verificare sempre le fonti ufficiali correnti prima della firma.
