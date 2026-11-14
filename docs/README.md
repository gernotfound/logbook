# TheLogBook — indice documentazione

Questo file è la **mappa dei documenti**; non è un contratto di esecuzione né una prova dello stato Production. I contratti operativi hanno un solo punto di ingresso in AGENTS; le guide sotto non ne ampliano il mandato.

## Gerarchia e uso corretto

1. **Istruzioni per agenti:** [`AGENTS.md`](../AGENTS.md) è il file comandante e contiene la mappa dei [contratti specialistici](../.agents/rules/), da aprire esplicitamente secondo il task. I sottofile specializzano, senza contraddire o ampliare il mandato.
2. **Implementazione:** codice, tipi, test e workflow al vero HEAD GitHub di `main` definiscono il comportamento verificabile; indagare divergenze con le istruzioni, non ignorarle.
3. **Provider esterni:** stato live di Firebase, Google Cloud, Vercel, GitHub e altri va verificato nel provider, mai dedotto dai documenti.
4. **Questa cartella:** contiene decisioni di prodotto, guide, registri e documenti legali incompleti. Le etichette qui descrivono *lo stato del documento*, non certificano runtime, privacy o conformità legale.

Leggere **solo ciò che riguarda il task**; per cambi trasversali consultare tutti i riferimenti pertinenti. Una **PROPOSTA NON IMPLEMENTATA** non diventa un requisito corrente; un **template** non è approvato né firmato.

## Contratti e guide: quale fonte usare

La selezione completa dei contratti resta in [AGENTS](../AGENTS.md). Qui si indicano solo le relazioni fra guida e fonte normativa.

| Guida o attività | Contratto normativo |
|---|---|
| Archivio device e chiave cloud | [Archivio e cifratura](../.agents/rules/secure-storage.md) |
| Workout, editor e copie indipendenti | [Bozze e stato device](../.agents/rules/device-drafts.md) |
| Backup, import e CSV | [Portabilità](../.agents/rules/backup-and-portability.md) |
| Consenso, diritti e cancellazione soli dati | [Consenso salute](../.agents/rules/health-consent.md) |
| Gestione errori client e assenza di monitoraggio esterno | [Telemetria e privacy](../.agents/rules/telemetry-and-privacy.md) |
| CI e collaudi | [Verifica CI](../.agents/rules/ci-verification.md) |

## Architettura

| Documento | Stato | Per quale attività |
|---|---|---|
| [Archivio locale cifrato](architecture/secure-local-archive-design.md) | Specifica approvata e rilasciata; smoke reali separati | Cifratura, migrazione, recovery, modello di minaccia |

## Operazioni e configurazioni esterne

| Documento | Stato | Per quale attività |
|---|---|---|
| [Registro servizi esterni](operations/external-services-register.md) | Inventario corrente, rischi provider e gate target | Cloudflare, Kinde, codice legacy ancora usato e GitHub |
| [Setup Kinde](operations/kinde-auth-setup.md) | Onboarding provider, application type, autenticazione email/Google e gate ancora aperti | CF-03, solo configurazione Kinde |
| [Runbook Cloudflare](operations/cloudflare-workers-migration.md) | Guida corrente per sviluppo, gate e abbandono del vecchio stack | Workers/D1, Auth, privacy e release |
| [Collaudi E2E e affidabilità](operations/e2e-reliability.md) | Guida corrente sui limiti delle prove; collaudi live separati | CI sintetica, dispositivi reali e perimetro Production |

## Diagnostica

| Documento | Stato | Per quale attività |
|---|---|---|
| [Debug ripresa sincronizzazione](BACKGROUND_SYNC_DEBUG.md) | Guida diagnostica al comportamento corrente | Replay journal, online/foreground, compatibilità browser |

## Privacy, dati salute e accesso di utenti esterni

Il [pacchetto compliance](compliance/README.md) distingue l'uso personale del progetto dalla prevista apertura gratuita ad altri utenti maggiorenni. **Il gate per l'accesso di utenti esterni con dati reali è ancora NO-GO**, anche senza accordi commerciali: prima dell'apertura restano da chiudere le verifiche tecniche, privacy e legali indicate nel dossier. Il pacchetto **non certifica conformità GDPR** e richiede revisione professionale.

| Documento | Stato | Per quale attività |
|---|---|---|
| [Pacchetto compliance / utenti esterni](compliance/README.md) | Gate pre-utenti esterni NO-GO | Requisiti tecnici, privacy e legali prima di qualsiasi apertura a terzi |
| [Ruolo privacy del gestore e dei fornitori](compliance/controller-role-decision.md) | Valutazione da validare | Finalità, ruoli e fornitori tecnici |
| [Procedura diritti interessati](compliance/data-subject-rights-procedure.md) | Procedura interna da completare | Accesso, portabilità, rettifica, cancellazione |
| [Screening DPIA](compliance/dpia-screening-template.md) | Template da completare | Screening dei rischi e decisione DPIA |
| [Valutazione DPO](compliance/dpo-assessment-template.md) | Template da completare | Obbligo di nomina |
| [Consenso salute: decisione e gate](compliance/health-consent-release-gate.md) | Revoca implementata; gate legale e collaudi autenticati aperti | Revoca, diritti ed eventuale riaccettazione |
| [Consenso salute: protocollo](compliance/health-consent-technical-protocol.md) | Contratto tecnico implementato; verifiche Production e gate legale aperti | Fence, journal, offline e cross-device |
| [Runbook incidenti / breach](compliance/incident-breach-runbook.md) | Procedura da assegnare e provare | Gestione, escalation e notifiche |
| [Registro trattamenti](compliance/processing-record-template.md) | Template Art. 30 da completare | Attività e finalità del trattamento |
| [Retention schedule](compliance/retention-schedule.md) | Policy da approvare e verificare | Conservazione e cancellazioni |
| [Misure tecniche/organizzative](compliance/technical-organizational-measures.md) | Scheda da verificare sul live | Sicurezza tecnica vs provider |
| [Fornitori e trasferimenti](compliance/vendor-transfer-register.md) | Registro da validare | Ruoli fornitori e trasferimenti |

## Guide delle suite

Le guide [tests/README.md](../tests/README.md), [fuzz](../tests/fuzz/README.md), [recovery](../tests/recovery/README.md), [GC](../tests/gc/README.md) e [hardening](../tests/hardening/README.md) spiegano suite e oracle. I comandi `verify:m2`–`verify:m5` restano sottogate diagnostici inclusi nella catena corrente: non sostituiscono `verify:m8` o la CI equivalente exact-SHA.

## Regole per la manutenzione

- Aggiornare i collegamenti quando cambia un percorso documentale e cercare prima tutti i riferimenti da `AGENTS.md`, `.agents/rules/`, README, codice, test e workflow. Preferire **link e indici** a spostamenti non necessari.
- Ogni nuovo documento deve dichiarare scopo, stato (attivo, storico, proposta o bozza) e limiti delle verifiche. Non confondere evidenze di un commit storico con lo stato corrente del runtime.
- Aggiornare il relativo contratto specialistico solo se muta davvero una regola. Gli indici facilitano la scoperta, non sono automaticamente caricati dall'AI.
- Non aggiungere credenziali, dati personali né report task-specific temporanei. Questi ultimi restano normalmente nella cronologia Git/PR.

## Attività pianificate

Le attività future si gestiscono in [GitHub Issues](https://github.com/gernotfound/logbook/issues), non in file `ToDo.md` della root. L'ambiente Firebase/Vercel Test separato è stato **dismesso il 18 ottobre 2026**: la [issue #426](https://github.com/gernotfound/logbook/issues/426) è chiusa come non pianificata. Restano attivi i test locali/CI; non programmare collaudi cloud distruttivi su Production.
