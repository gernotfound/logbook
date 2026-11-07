# Dati salute e revoca del consenso — decisione e gate pre-pilot

> Stato tecnico al **6 novembre 2026**, issue [#824](https://github.com/gernotfound/logbook/issues/824). L'implementazione è integrata tramite [PR #826](https://github.com/gernotfound/logbook/pull/826) e [PR #829](https://github.com/gernotfound/logbook/pull/829). La CI non dimostra il collaudo autenticato in Production.
> **Gate pre-utenti esterni: NO-GO.** Restano aperti collaudi multi-dispositivo, configurazioni e contratti dei fornitori, validazione giuridica delle basi e della conservazione residua. Questo documento non è un parere legale né una DPIA.

## Decisioni di prodotto per la beta pubblica (6 novembre 2026)

- La **beta è l'applicazione completa attuale**, non una variante limitata: registrazione libera a qualsiasi maggiorenne, senza inviti e senza introdurre restrizioni artificiali alle funzioni. La dicitura beta non esonera dagli obblighi GDPR o dai requisiti di sicurezza.
- I partecipanti possono inserire **dati personali reali**, inclusi dati che possono rientrare nell'art. 9 GDPR: il gate legale e i collaudi di Production restano quindi obbligatori **prima** dell'apertura a terzi.
- Maggiore età: dichiarazione esplicita **18+ separata** dall'accettazione dei termini e dal consenso salute, senza raccogliere data di nascita o documento. È un'autodichiarazione, **non** una verifica anagrafica forte.
- La **modalità ospite** continua a usare soltanto il vault locale e rimane disponibile. Nessun consenso o dato guest è automaticamente attribuito a un nuovo account.
- **Nessun reset alla fine della beta:** tutti i dati creati nella baseline supportata devono rimanere disponibili attraverso le release, salvo cancellazione avviata dall'utente, revoca del consenso o futura policy d'inattività effettivamente implementata e giuridicamente validata.
- La politica proposta per l'inattività dell'account (12 mesi, attività autenticata online, senza email di preavviso) è analizzata nel [piano di conservazione](retention-schedule.md). Il product owner ha **accettato esplicitamente il rischio per chi utilizza la PWA esclusivamente offline per oltre 12 mesi**. L'accettazione del rischio non sostituisce la revisione legale né autorizza sperimentazioni distruttive in Production. I gate di attivazione restano disabilitati finché il rilascio non è approvato.

**Fonti tecniche:** [AGENTS](../../AGENTS.md), [consenso salute](../../.agents/rules/health-consent.md), [protocollo distribuito](health-consent-technical-protocol.md), [retention](retention-schedule.md). Le alternative precedenti alla PR #826, inclusa la cancellazione solo su pulsante, restano nella cronologia Git e **non** descrivono il contratto attuale.

## Contesto

La PWA tratta allenamento, alimentazione, misurazioni corporee, sonno e annotazioni sul dolore; a seconda del contenuto e del contesto, alcuni dati possono rientrare nelle categorie particolari dell'art. 9 GDPR. Le basi dei singoli trattamenti richiedono valutazione ex art. 6 e, quando applicabile, art. 9, oltre alla libertà del consenso secondo l'art. 7. La protezione tecnica dei dati non costituisce una base giuridica autonoma per conservarli.

Fonti per la revisione: [GDPR, artt. 6, 7, 9, 13, 17 e 25](https://eur-lex.europa.eu/eli/reg/2016/679/oj); [EDPB, Linee guida 05/2020](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en); [Garante Privacy, principi fondamentali](https://garanteprivacy.it/web/guest/home/principi-fondamentali-del-trattamento).

## Decisione approvata e implementata — 6 novembre 2026

1. **Prima della revoca:** backup JSON facoltativo, offerto senza renderlo un ostacolo all'esercizio della revoca. Il file esportato è sotto il controllo dell'utente e contiene dati in chiaro.
2. **Revoca account:** sospensione immediata delle funzionalità fitness. La conferma trusted registra `health_consent_withdrawals/{uid}` e accoda `health_data_erasures/{uid}` nella **stessa transazione Firestore**. Worker con lease/retry e cron cancellano i dati applicativi, verificano i residui e rimuovono la chiave cloud soltanto alla finalizzazione sicura. **Firebase Authentication rimane attiva come identità di account**, salvo richiesta distinta di cancellazione account.
3. **Revoca offline:** stato locale pending e blocco immediato; nessuna dichiarazione di completamento cloud senza conferma server. Il journal pre-revoca non viene reinviato.
4. **Purge locale:** avviene soltanto dopo prova trusted `complete`, verifica della revisione/`erasedBeforeRevision` e dell'assenza della chiave cloud, nel lock owner-scoped. Se la ricevuta del job è stata ritirata dopo 30 giorni, il backend può ricostruire quella prova dalla sola epoch persistente del consenso server, purché restino `withdrawn`, UID coerente, `revision = erasedBeforeRevision + 1` e chiave cloud assente. Il marker locale non è una prova; errori e cancellazioni parziali conservano gli originali necessari al recovery.
5. **Ospite:** cancellazione protetta dei dati locali e fine sessione; nessuna richiesta cloud. Una successiva sessione ospite è una generazione nuova.
6. **Nuovo consenso:** solo esplicito, dopo erasure `complete` e pulizia dell'archivio precedente; riparte su archivio vuoto. Non esiste riaccettazione offline sul vecchio archivio né modalità fitness ridotta.

L'endpoint rights-only può continuare a gestire stati di revoca previsti dal protocollo, ma **non promette un export completo durante un job attivo**. Il backup completo è pertanto proposto prima della revoca. Le richieste successive di accesso/diritti richiedono una risposta adeguata alle copie effettivamente ancora disponibili; non giustificano la retention indefinita.

## Invarianti di sicurezza

- Revoca locale, stato server e cancellazione terminata sono prove distinte. Non permettere a client, tab, token, snapshot o journal obsoleti di ripubblicare la generazione cancellata.
- Il campo business `UserData.legalConsent` non sostituisce il marker trusted server-only. Verificare UID, epoch Auth, revisione, sessione, App Check e versioni legali nei boundary previsti.
- Il worker completa root e sottoraccolte, verifica i residui inattesi e non distrugge la chiave cloud prima della finalizzazione. Ricevute e fence restano disponibili per recovery e prevenzione del replay.
- La pulizia locale può coinvolgere soltanto l'owner attestato e richiede receipt valida e lock. Nessuna purga dedotta dal solo stato UI, da un timeout o da un errore di rete.
- Dispositivi permanentemente offline, file JSON/CSV esportati e copie nei provider non sono cancellabili automaticamente dal client: documentare questi limiti senza promettere cancellazione universale.
- Revoca e cancellazione dei dati fitness sono accoppiate nel flusso attuale; **cancellazione dell'identità Firebase Auth è distinta**. Una modifica materiale alla UI/informativa richiede rivalutazione di `LEGAL_VERSIONS.privacy`.

## Regressioni CRITICAL e prove necessarie

- Consenso iniziale, revoca offline e ritorno online, sospensione di workout, mutazioni e scritture in volo.
- Concorrenza multi-tab/device, variazione di UID/epoch Auth, token scaduti, App Check indisponibile, richieste stantie e ack perduti.
- Worker `requested/deleting/verifying/failed/complete`, lease, retry/cron, residui imprevisti, chiave cloud rimossa solo dopo verifica.
- Pulizia owner-scoped, dati di altri proprietari intatti, recovery locale, assenza di replay da vecchi journal/backup e re-consenso solo su archivio vuoto.
- Guest, guest→account, logout, export precedente alla revoca e account deletion separata.
- Rules Emulator, CI canonica exact-SHA, accessibilità e UI su dispositivi, temi e viewport pertinenti.

## Gate pre-pilot — aperto

- [x] Decisione prodotto e implementazione integrate: PR #826 (revoca con cancellazione automatica e backup precedente facoltativo), PR #829 (rimozione riaccettazione offline obsoleta).
- [ ] Collaudo end-to-end **autenticato** con dati sintetici su dispositivi distinti, inclusi fallimenti, retry, copie offline e verifica delle raccolte/chiave cloud. CI e deploy non sostituiscono la prova runtime.
- [ ] Verifica live di Firestore location, PITR/backup e regole di restore, configurazioni Firebase/App Check, trattamento log e trasferimenti dei provider.
- [ ] Chiarimento contrattuale su DPA Vercel **Hobby**, subprocessori, localizzazioni, retention e opzione AI applicabile; nessuna deduzione dai soli log.
- [ ] Matrice per finalità con artt. 6 e 9, minimizzazione e termini motivati per marker/ricevute/Auth/copie provider, procedura diritti e screening DPIA validati da professionista competente.
- [ ] Informativa pubblica e documenti approvati per i primi utenti esterni; decisione GO motivata. Sino ad allora: **NO-GO**.

Riferimenti operativi: [procedura diritti](data-subject-rights-procedure.md), [retention](retention-schedule.md), [fornitori](vendor-transfer-register.md), [protocollo](health-consent-technical-protocol.md), [E2E e Production](../operations/e2e-reliability.md).
