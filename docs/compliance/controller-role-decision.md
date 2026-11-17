# Valutazione dei ruoli GDPR — TheLogBook

> Documento interno da validare professionalmente prima dell'accesso di utenti esterni. I ruoli dipendono dalle finalità e dai mezzi effettivi del trattamento; questa scheda non è una qualifica legale approvata.

## Modello di utilizzo da valutare

- TheLogBook è un progetto amatoriale gratuito gestito da Gerardo Califano, persona fisica (dichiarazione del product owner del 5 novembre 2026).
- È prevista la registrazione autonoma di altri utenti maggiorenni per inserire i propri dati di allenamento, nutrizione e misurazioni.
- Il gestore stabilisce il funzionamento dell'applicazione; Firebase/Google e Vercel prestano servizi tecnici secondo ruoli e condizioni da verificare nei rispettivi documenti contrattuali e nel [registro fornitori](vendor-transfer-register.md).
- L'assenza di una società o di corrispettivi economici non esonera automaticamente dagli obblighi GDPR. Non dedurre i ruoli giuridici dalla sola architettura o dalla dichiarazione del gestore.

## Verifica fattuale

| Questione | Stato da documentare | Fonte |
|---|---|---|
| Chi determina le finalità del trattamento dei dati degli utenti? | `[DA VALIDARE]` | Funzioni del servizio, informativa e decisioni del gestore |
| Chi determina i mezzi essenziali del trattamento? | `[DA VALIDARE]` | Architettura, configurazioni, scelte di prodotto |
| Quali fornitori trattano dati personali per erogare i servizi tecnici? | `[DA VERIFICARE]` | [Registro fornitori](vendor-transfer-register.md), contratti e configurazioni live |
| Quali dati e metadati possono essere accessibili ai fornitori? | `[DA VERIFICARE]` | [Registro trattamenti](processing-record-template.md), [misure tecniche](technical-organizational-measures.md) |
| Quali accordi Art. 28 o altre garanzie sono applicabili ai fornitori? | `[DA VALIDARE]` | Termini e DPA effettivamente applicabili a Firebase/Google e Vercel |
| Esistono altre finalità autonome dei fornitori (es. log tecnici)? | `[DA VALIDARE]` | Informative, registro fornitori e [retention](retention-schedule.md) |

L'eventuale responsabilità del gestore come titolare va valutata per le finalità e i mezzi da lui determinati. La qualifica dei fornitori non si può dedurre automaticamente dal nome del servizio, dalla presenza di Firebase Admin o dalla cifratura.

## Esito da approvare

- Ruolo del gestore rispetto alle attività rilevate: `[TITOLARE / ALTRO / DA VALIDARE]`.
- Motivazione, finalità e mezzi: `[FATTI E PROVE]`.
- Ruolo e garanzie per ciascun fornitore: `[FORNITORE / TRATTAMENTO / DOCUMENTO APPLICABILE]`.
- Impatto su informativa, registro trattamenti e trasferimenti: `[MODIFICHE NECESSARIE]`.
- Data, valutazione professionale e approvazione: `[DATA / RESPONSABILE / REVISORE]`.

Riesaminare la valutazione quando cambiano finalità, accessi ai dati, fornitori, condivisione o modalità effettive di trattamento. Non presentare i segnaposto come conclusioni già approvate.
