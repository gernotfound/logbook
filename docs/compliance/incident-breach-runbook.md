# Incident & personal data breach runbook — LogBook

> Procedura operativa. Assegnare persone/canali reali e provarla prima del pilot.

## 1. Attivazione

Aprire un incidente quando esiste o è ragionevole sospettare:

- accesso non autorizzato a dati utenti;
- leakage fra account/dispositivi;
- perdita, corruzione o cancellazione non intenzionale di dati;
- compromissione credenziali/segreti;
- Rules/App Check/IAM configurati in modo da ampliare accessi;
- esposizione di log/telemetria con dati personali;
- violazione presso un fornitore che coinvolga LogBook.

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

Se il provider agisce come titolare, la notifica all'autorità competente va valutata senza ingiustificato ritardo e, ove possibile, entro 72 ore dalla conoscenza quando il breach è suscettibile di presentare un rischio. Se esiste rischio elevato, valutare anche comunicazione agli interessati.

Se il provider agisce come responsabile per uno specifico trattamento, notificare il titolare senza ingiustificato ritardo secondo contratto e Art. 33.

- Ora conoscenza: `[UTC]`
- Deadline 72h di riferimento: `[UTC]`
- Autorità: Garante per la protezione dei dati personali `[VERIFY_COMPETENCE]`
- Palestra da informare: `[YES/NO/WHY]`
- Interessati da informare: `[YES/NO/WHY]`

## 6. Contenimento e recovery

- revoca/rotazione credenziali se coinvolte;
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
