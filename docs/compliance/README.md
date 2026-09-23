# LogBook — pacchetto compliance per il primo pilot

> Stato: struttura operativa da completare e far revisionare professionalmente prima della prima palestra.
> Ultimo aggiornamento tecnico: 23 settembre 2026.
> Questo pacchetto non certifica conformità GDPR e non sostituisce consulenza legale, privacy o fiscale.

## Obiettivo

Questa cartella raccoglie i documenti operativi che servono per trasformare le scelte tecniche di LogBook in un processo dimostrabile: registro dei trattamenti, screening DPIA, retention, incident response, fornitori/trasferimenti, misure tecniche e organizzative, gestione dei diritti e documentazione B2B.

La fonte di verità tecnica resta il repository corrente. Le configurazioni esterne — Firebase/Google Cloud, Vercel, GitHub e relativi account amministrativi — devono essere verificate direttamente prima del pilot e non vanno dedotte da questi template.

## Assunzioni correnti del pilot

- La palestra paga tramite rapporto commerciale esterno alla PWA.
- La palestra rende LogBook disponibile agli iscritti ma, nell'architettura attuale, non dispone di ruoli gym/coach/admin e non accede ai dati LogBook degli utenti.
- LogBook resta destinato a maggiorenni.
- Google/Firebase Analytics non fa parte del prodotto.
- Vercel Analytics e Speed Insights sono opzionali e disabilitati per default.
- La telemetria proprietaria è destinata a diagnostica, integrità e recovery, non a misurare il comportamento di allenamento o il funnel PWA.

Queste assunzioni devono essere riconfermate nella documentazione firmata; se cambiano, vanno rivalutati ruoli privacy, contratti, informativa e DPIA.

## Documenti

| File | Scopo | Stato prima del pilot |
|---|---|---|
| `processing-record-template.md` | Registro trattamenti / RoPA | Compilare e firmare |
| `controller-role-decision.md` | Decisione documentata sui ruoli provider/palestra | Validare professionalmente |
| `dpia-screening-template.md` | Screening Art. 35 e decisione DPIA | Completare e firmare |
| `retention-schedule.md` | Durate, trigger di cancellazione e verifiche | Approvare e allineare al runtime |
| `incident-breach-runbook.md` | Gestione incidenti e data breach | Assegnare contatti e provare il flusso |
| `vendor-transfer-register.md` | Fornitori, subprocessori e trasferimenti | Verificare contratti e localizzazioni |
| `technical-organizational-measures.md` | TOM / misure Art. 32 | Verificare elementi esterni |
| `legitimate-interest-assessment-template.md` | LIA della telemetria tecnica | Compilare se si mantiene Art. 6(1)(f) |
| `dpo-assessment-template.md` | Valutazione obbligo DPO | Compilare e riesaminare su aumento scala |
| `data-subject-rights-procedure.md` | Accesso, rettifica, portabilità, cancellazione, revoche | Assegnare canale privacy |
| `support-sla-policy-template.md` | Supporto, severità e impegni di servizio | Definire solo promesse sostenibili |
| `exit-deletion-policy-template.md` | Cessazione B2B e dati | Allineare al ruolo privacy |
| `gym-privacy-instructions-template.md` | Istruzioni operative alla palestra | Consegnare/adattare al pilot |
| `first-gym-b2b-checklist.md` | Gate di consegna alla palestra | Chiudere tutti i blocker |
| `saas-agreement-template.md` | Struttura contratto commerciale | Revisione legale + dati reali |
| `commercial-schedule-template.md` | Allegato economico separato | Compilare con dati commerciali |
| `dpa-art28-template.md` | Allegato Art. 28 condizionale | Usare solo se il ruolo processor è confermato |

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
