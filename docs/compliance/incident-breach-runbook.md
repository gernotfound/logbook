# Incident & personal data breach runbook — TheLogBook

> Procedura operativa. Assegnare persone/canali reali e provarla prima del pilot.

## 1. Attivazione

Aprire un incidente quando esiste o è ragionevole sospettare:

- accesso non autorizzato a dati utenti;
- leakage fra account/dispositivi;
- perdita, corruzione o cancellazione non intenzionale di dati;
- compromissione credenziali/segreti;
- Rules/App Check/IAM configurati in modo da ampliare accessi;
- esposizione di log/telemetria con dati personali;
- violazione presso un fornitore che coinvolga TheLogBook.

Incident ID: `INC-[YYYY]-[NNN]`.

## 2. Prime azioni

1. Registrare ora UTC di scoperta e chi ha rilevato l'evento.
2. Preservare evidenze senza copiare inutilmente dati personali.
3. Contenere il rischio con la misura meno distruttiva possibile.
4. Non cancellare log/evidenze necessari all'analisi salvo rischio attivo.
5. Identificare sistemi, utenti potenzialmente coinvolti, categorie dati e intervallo temporale.
6. Verificare se il problema è ancora attivo.
7. Avvisare `[INCIDENT_OWNER]` e `[PRIVACY_OWNER]`.

## 3. Scheda incidente

| Campo | Valore |
|---|---|
| ID | `[INC_ID]` |
| Scoperta | `[UTC_TIMESTAMP]` |
| Fonte | `[SOURCE]` |
| Sistemi | `[SYSTEMS]` |
| Descrizione fattuale | `[FACTS]` |
| Dati coinvolti | `[DATA_CATEGORIES]` |
| Dati salute | `[YES/NO/UNKNOWN]` |
| N. interessati | `[ESTIMATE]` |
| Stato contenimento | `[STATUS]` |
| Causa radice | `[ROOT_CAUSE/UNKNOWN]` |
| Evidenze | `[REFERENCES]` |

## 4. Valutazione privacy

Determinare e documentare:

- se si è verificata una violazione di sicurezza che comporta distruzione, perdita, modifica, divulgazione non autorizzata o accesso a dati personali;
- probabilità e gravità del rischio per diritti e libertà;
- natura/sensibilità dei dati, inclusi eventuali dati salute;
- volume, durata, reversibilità, cifratura/pseudonimizzazione e facilità di identificazione;
- conseguenze realistiche e misure già applicate.

Decisione: `[NOT_A_BREACH / BREACH_NO_NOTIFICATION / NOTIFY_AUTHORITY / NOTIFY_AUTHORITY_AND_USERS]`.

## 5. Scadenze e notifiche

Se TheLogBook agisce come **titolare** del trattamento e la violazione è suscettibile di presentare un rischio per i diritti e le libertà, notificare all'autorità competente senza ingiustificato ritardo e, ove possibile, entro 72 ore da quando si è avuta conoscenza della violazione. Quando il rischio è elevato, comunicare la violazione agli interessati senza ingiustificato ritardo, salvo le eccezioni dell'art. 34, par. 3, da documentare.

Se TheLogBook agisce come **responsabile** per conto di una palestra o di un altro titolare, informare quest'ultimo senza ingiustificato ritardo appena accertata la violazione, secondo gli obblighi contrattuali e l'art. 33, par. 2. **Non attendere** la conclusione dell'analisi della causa radice o della valutazione del rischio: spetta al titolare stabilire se notificare l'autorità e gli interessati. Trasmettere tempestivamente ulteriori dettagli quando disponibili.

Se la notifica al Garante è necessaria ma alcuni dettagli non sono ancora disponibili, inviare nei termini le informazioni già accertate e integrarle successivamente senza ulteriore ingiustificato ritardo (art. 33, par. 4). Una notifica oltre le 72 ore deve spiegare i motivi del ritardo. Registrare gli orari delle decisioni, delle notifiche e delle integrazioni; **non** far decorrere il termine dall'ultimazione dell'indagine tecnica.

Riferimenti: [Garante — Data breach](https://www.garanteprivacy.it/data-breach); [EDPB — Linee guida 9/2022, versione finale](https://www.edpb.europa.eu/documents/guideline/guidelines-92022-on-personal-data-breach-notification-under-gdpr_en).

- Ora conoscenza: `[UTC]`
- Deadline 72h di riferimento: `[UTC]`
- Autorità: Garante per la protezione dei dati personali `[VERIFY_COMPETENCE]`
- Palestra da informare: `[YES/NO/WHY]`
- Interessati da informare: `[YES/NO/WHY]`

## 6. Contenimento e recovery

- revoca/rotazione delle credenziali coinvolte; per una chiave di cifratura non sovrascrivere o dismettere l'unica chiave esistente: preservare materiale ed evidenze, contenere gli accessi e seguire il processo versionato di rewrap/verifica di [Cifratura](../../.agents/rules/secure-storage.md); la rotazione di credenziali Auth non equivale alla rotazione di `CLOUD_ACCOUNT_KEK_V1`;
- chiusura accessi non necessari;
- correzione root cause via branch/PR/CI, senza bypass dei guardrail;
- verifica post-fix su GitHub, Vercel e Firebase/Google Cloud pertinenti;
- restore solo da backup verificato;
- smoke test su isolamento account, sync, deletion e accessi interessati.

## 7. Chiusura

Un incidente si chiude solo con:

- root cause identificata o rischio residuo esplicitamente accettato;
- contenimento verificato;
- notifiche/decisioni documentate;
- azioni correttive assegnate;
- aggiornamento TOM/DPIA/RoPA se necessario;
- retrospettiva e test di regressione quando applicabili.

Conservare il registro incidente anche quando si decide di non notificare, con motivazione della valutazione.
