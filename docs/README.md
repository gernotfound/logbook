# TheLogBook — indice documentazione

Questo file è la **mappa dei documenti**; non è un contratto di esecuzione né una prova dello stato Production. Tutti i percorsi esistenti sono mantenuti per preservare riferimenti e compatibilità.

## Gerarchia e uso corretto

1. **Istruzioni per agenti:** [`AGENTS.md`](../AGENTS.md) e i [13 contratti specialistici](../.agents/rules/) definiscono obblighi e vincoli.
2. **Implementazione:** codice, tipi, test e workflow al vero HEAD GitHub di `main` definiscono il comportamento verificabile; indagare divergenze con le istruzioni, non ignorarle.
3. **Provider esterni:** stato live di Firebase, Google Cloud, Vercel, GitHub e altri va verificato nel provider, mai dedotto dai documenti.
4. **Questa cartella:** contiene decisioni di prodotto, guide, registri, documenti legali incompleti, proposte e storico. Le etichette qui descrivono *lo stato del documento*, non certificano runtime, privacy o conformità legale.

Leggere **solo ciò che riguarda il task**; per cambi trasversali consultare tutti i riferimenti pertinenti. Una **PROPOSTA NON IMPLEMENTATA** non diventa un requisito corrente; uno **STORICO** non è una checklist per il prossimo deploy; un **template** non è approvato né firmato.

## Architettura

| Documento | Stato | Per quale attività |
|---|---|---|
| [Archivio locale cifrato](architecture/secure-local-archive-design.md) | Specifica approvata e rilasciata; smoke reali separati | Cifratura, migrazione, recovery, modello di minaccia |
| [Gateway cloud trusted](architecture/trusted-sync-gateway-design.md) | PROPOSTA NON IMPLEMENTATA | Valutare alternative e costi prima di eventuale decisione |

## Operazioni e configurazioni esterne

| Documento | Stato | Per quale attività |
|---|---|---|
| [Registro servizi esterni](operations/external-services-register.md) | Registro operativo; riscontri live necessari | Firebase, Vercel, Sentry, GitHub e servizi ritirati |
| [Ambiente Firebase Test isolato](operations/firebase-test-environment.md) | PREPARAZIONE IN CORSO, NON pronto per E2E | Configurazione Test riferita dal product owner, guardrail e verifiche ancora mancanti |
| [Cutover Firebase Hosting](operations/firebase-hosting-cutover.md) | STORICO completato il 2 ottobre 2026 | Decisioni e rollback storici, non procedura di deploy corrente |

## Diagnostica

| Documento | Stato | Per quale attività |
|---|---|---|
| [Debug Background Sync](BACKGROUND_SYNC_DEBUG.md) | Guida diagnostica da verificare sul codice corrente | Replay journal, online/foreground, compatibilità browser |
| [Guida Sentry](telemetry-sentry-guide.md) | Guida operativa da verificare sul provider | Error monitoring, privacy, source map e retention |

## Privacy, dati salute e rapporti con le palestre

Il [pacchetto compliance](compliance/README.md) contiene le decisioni aperte e le azioni pre-pilot. **Non certifica conformità GDPR** e richiede revisione professionale prima dell'uso contrattuale.

| Documento | Stato | Per quale attività |
|---|---|---|
| [Pacchetto compliance / primo pilot](compliance/README.md) | Indice pre-pilot, revisione professionale aperta | Percorso per verifiche tecniche, legali e commerciali |
| [Allegato commerciale](compliance/commercial-schedule-template.md) | Template non approvato/firmato | Termini economici |
| [Ruoli privacy provider / palestra](compliance/controller-role-decision.md) | Decisione non finalizzata | Titolare, responsabile e condizioni |
| [Procedura diritti interessati](compliance/data-subject-rights-procedure.md) | Procedura interna da completare | Accesso, portabilità, rettifica, cancellazione |
| [DPA Art. 28](compliance/dpa-art28-template.md) | Template condizionale non firmato | Solo se i ruoli giuridici richiedono un DPA |
| [Screening DPIA](compliance/dpia-screening-template.md) | Template da completare | Screening dei rischi e decisione DPIA |
| [Valutazione DPO](compliance/dpo-assessment-template.md) | Template da completare | Obbligo di nomina |
| [Exit e cancellazione B2B](compliance/exit-deletion-policy-template.md) | Template da validare | Cessazione palestra distinta dagli account utente |
| [Checklist prima palestra](compliance/first-gym-b2b-checklist.md) | Gate pre-pilot ancora da verificare | Condizioni di go-live |
| [Istruzioni privacy palestra](compliance/gym-privacy-instructions-template.md) | Template dipendente dai ruoli validati | Indicazioni per iscritti e palestra |
| [Consenso salute: decisione e gate](compliance/health-consent-release-gate.md) | Decisione UX approvata; gate legale/manuale aperto | Revoca, diritti ed eventuale riaccettazione |
| [Consenso salute: protocollo](compliance/health-consent-technical-protocol.md) | Comportamento tecnico descritto; verifica pre-pilot aperta | Fence, journal, offline e cross-device |
| [Runbook incidenti / breach](compliance/incident-breach-runbook.md) | Procedura da assegnare e provare | Gestione, escalation e notifiche |
| [LIA telemetria](compliance/legitimate-interest-assessment-template.md) | Template condizionale | Valutazione dell'interesse legittimo |
| [Registro trattamenti](compliance/processing-record-template.md) | Template Art. 30 da completare | Attività e finalità del trattamento |
| [Retention schedule](compliance/retention-schedule.md) | Policy da approvare e verificare | Conservazione e cancellazioni |
| [Accordo SaaS palestra](compliance/saas-agreement-template.md) | Bozza non firmata | Contratto commerciale |
| [Supporto e SLA](compliance/support-sla-policy-template.md) | Template da approvare | Impegni di servizio sostenibili |
| [Misure tecniche/organizzative](compliance/technical-organizational-measures.md) | Scheda da verificare sul live | Sicurezza tecnica vs provider |
| [Fornitori e trasferimenti](compliance/vendor-transfer-register.md) | Registro da validare | Ruoli fornitori e trasferimenti |

## Regole per la manutenzione

- Aggiornare i collegamenti quando cambia un percorso documentale e cercare prima tutti i riferimenti da `AGENTS.md`, `.agents/rules/`, README, codice, test e workflow. Preferire **link e indici** a spostamenti non necessari.
- Ogni nuovo documento deve dichiarare scopo, stato (attivo, storico, proposta o bozza) e limiti delle verifiche. Non confondere evidenze di un commit storico con lo stato corrente del runtime.
- Aggiornare il relativo contratto specialistico solo se muta davvero una regola. Gli indici facilitano la scoperta, non sono automaticamente caricati dall'AI.
- Non aggiungere credenziali, dati personali né report task-specific temporanei. Questi ultimi restano normalmente nella cronologia Git/PR.

## Attività pianificate

Le attività future si gestiscono in [GitHub Issues](https://github.com/gernotfound/logbook/issues), non in file `ToDo.md` della root. L'[ambiente Firebase Test isolato](https://github.com/gernotfound/logbook/issues/426) è una proposta operativa da verificare; la presenza dell'issue non prova che l'ambiente esista.
