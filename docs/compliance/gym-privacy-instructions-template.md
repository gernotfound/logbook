# Istruzioni privacy per un'eventuale palestra — template pre-pilot

> **Stato: bozza interna non approvata e non consegnata.** TheLogBook è attualmente un progetto amatoriale gratuito; non risultano collaborazioni o contratti con palestre. Questo documento riguarda soltanto un possibile futuro accordo B2B, non descrive un servizio già attivato e non autorizza l'accesso di utenti esterni: il [gate pre-utenti esterni](README.md) è ancora **NO-GO**.
>
> Prima di usare queste istruzioni: validare i ruoli effettivi tra le parti nella [decisione sui ruoli privacy](controller-role-decision.md), adeguare il [contratto SaaS](saas-agreement-template.md) e far revisionare professionalmente la documentazione. Le istruzioni non sostituiscono l'informativa della palestra per i trattamenti di cui essa è responsabile, né l'informativa TheLogBook.

## Perimetro del possibile accordo

Nello scenario B2B compatibile con le funzionalità oggi presenti, la palestra **potrebbe limitarsi a segnalare** ai propri iscritti maggiorenni l'esistenza e il link di TheLogBook, una volta approvato l'accordo. L'utente sceglie autonomamente se utilizzare la PWA, creare un account e inserire dati; la palestra non possiede né amministra l'account.

TheLogBook non dispone di ruoli gym/coach/admin, dashboard o funzioni per associare gli account a una palestra. Non comunica automaticamente alla palestra i dati fitness degli utenti. I ruoli giuridici non si deducono da questa sola separazione tecnica: devono essere validati in base alle finalità e ai mezzi effettivi.

## Informazioni da comunicare agli interessati

Solo dopo l'approvazione del futuro accordo, la palestra può fornire il link ufficiale e indirizzare alle informative e ai termini **correnti dentro TheLogBook**. Deve precisare che:

- TheLogBook è un servizio distinto dalla palestra, destinato a persone di almeno 18 anni;
- l'uso, la creazione dell'account e l'inserimento dei dati sono scelte dell'interessato, nei limiti dei termini del servizio;
- TheLogBook serve al tracciamento personale e non offre diagnosi, prescrizioni o consulenza medica;
- la palestra non ottiene accesso alle informazioni registrate nell'app.

Non pubblicare materiali della palestra che presentino un accordo come già vigente prima delle necessarie approvazioni, o che sostituiscano impropriamente l'informativa TheLogBook con quella della palestra.

## Affermazioni e azioni da evitare

Non dichiarare né lasciare intendere che la palestra:

- possa leggere, cercare, esportare, modificare o cancellare allenamenti, nutrizione, peso, misurazioni, note o altri dati dell'account TheLogBook;
- riceva automaticamente report, statistiche individuali, avvisi sanitari o dati per allenatori;
- possa invitare nominalmente o amministrare utenti tramite un pannello gym/coach inesistente;
- possa chiedere password, token, credenziali, codici di accesso o backup personali dell'utente;
- possa esercitare per l'utente la revoca del consenso, cancellare l'identità Auth o garantire l'eliminazione di tutte le copie dei dati;
- possa assicurare disponibilità, tempi di assistenza o recupero dati diversi da quelli eventualmente approvati in un accordo di servizio separato.

Qualsiasi nuovo accesso o condivisione richiede una decisione di prodotto, una revisione dei ruoli privacy, dei contratti e delle informative **prima** dell'attivazione.

## Minimizzazione nelle richieste di supporto

Per assistenza commerciale o tecnica, utilizzare preferibilmente descrizioni del problema e dati sintetici. La palestra non deve raccogliere o inviare al fornitore, attraverso i normali canali di supporto:

- credenziali, password, token o codici di recupero;
- esportazioni JSON/CSV dell'utente o copie del suo archivio;
- screenshot, registrazioni o log con dati relativi alla salute o altri contenuti personali non necessari;
- elenchi nominativi degli iscritti allo scopo di identificarne gli account TheLogBook.

Se l'interessato comunica spontaneamente informazioni sensibili alla palestra, non inoltrarle automaticamente: limitarne l'accesso e chiedere al referente privacy competente di individuare un canale e una base appropriati, se un trattamento ulteriore è effettivamente necessario. La sola disponibilità tecnica di email o chat **non** dimostra che siano canali autorizzati per dati sanitari.

## Richieste sui dati personali

Distinguere sempre i trattamenti della palestra da quelli di TheLogBook; applicare la [procedura diritti](data-subject-rights-procedure.md) solo al perimetro e al soggetto pertinenti.

1. **Dati nell'account TheLogBook:** indicare gli strumenti disponibili nell'app e il contatto privacy TheLogBook verificato nella relativa informativa. La palestra non deve richiedere credenziali o esportazioni per inoltrare la richiesta; non deve promettere di eseguirla o di verificarne il completamento.
2. **Dati trattati dalla palestra:** gestire la richiesta attraverso il proprio referente e le proprie procedure, senza attribuirla automaticamente a TheLogBook.
3. **Richiesta mista o ruolo non chiaro:** farla valutare ai referenti privacy competenti, conservando e condividendo il minimo indispensabile e senza ignorare una richiesta già ricevuta. La decisione di chi debba rispondere deriva dai ruoli verificati, non dal presente template.

La revoca del consenso ai dati salute in TheLogBook sospende le funzioni fitness; per un account, la cancellazione dei dati applicativi è avviata dopo la conferma server. Un'operazione offline può restare in attesa e la cancellazione dell'account è separata. Non promettere una cancellazione immediata o universale su dispositivi offline, backup già esportati e copie tecniche dei fornitori. Non presentare una richiesta di export o cancellazione come completata senza le verifiche previste dal servizio.

## Segnalazioni di sicurezza e incidenti

In caso di sospetto accesso indebito, esposizione, perdita di dati o credenziali compromesse:

1. registrare **solo** natura del sospetto, momento della scoperta e recapito per il seguito, se necessario;
2. non chiedere password, esportazioni sanitarie o screenshot non minimizzati, né inoltrare l'evento in chat o liste di destinatari non autorizzate;
3. informare **senza ritardo** il referente sicurezza/privacy concordato e verificato nel futuro accordo, usando il canale di incidente approvato; non attendere di accertare da soli la causa;
4. preservare le evidenze strettamente necessarie e limitarne la diffusione; lasciare la valutazione del breach, la competenza delle notifiche e le comunicazioni ufficiali ai soggetti responsabili secondo i ruoli effettivi.

Seguire il [runbook incidenti](incident-breach-runbook.md) per l'escalation applicabile. Il template non assegna alla palestra un ruolo privacy né la responsabilità delle notifiche per i dati TheLogBook e non sostituisce i suoi eventuali obblighi propri.

## Contatti da convalidare prima della consegna

- Privacy TheLogBook: `[PRIVACY_EMAIL]` — deve corrispondere al recapito riportato nell'informativa pubblica corrente.
- Supporto TheLogBook: `[SUPPORT_EMAIL]` — non presumere un servizio di assistenza o SLA attivo.
- Referente privacy/sicurezza palestra: `[GYM_PRIVACY_CONTACT]`.
- Canale incidente concordato e verificato: `[INCIDENT_CHANNEL]`.
- Ruoli validati e versione dell'accordo: `[ROLE_DECISION / AGREEMENT_VERSION]`.
- Revisione professionale e approvazione: `[REVIEWER / APPROVAL_DATE]`.

**Non consegnare** il documento con contatti o ruoli non verificati. Rivederlo prima di introdurre accesso gym/coach, inviti nominativi, nuove finalità, dati condivisi o modifiche agli strumenti di esercizio dei diritti.
