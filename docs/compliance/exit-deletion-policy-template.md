# Exit, cessazione e cancellazione — template TheLogBook

> Definisce il comportamento alla fine del rapporto commerciale senza confondere il contratto palestra con il rapporto dell'utente con TheLogBook.

## Principio corrente

Nell'eventuale futuro modello pilota B2B, la palestra non possiederà né amministrerà gli account TheLogBook degli iscritti. La cessazione di un contratto B2B non comporterebbe automaticamente la cancellazione degli account o dei dati dei singoli utenti. Attualmente non è documentato alcun contratto con palestre.

## Cessazione palestra ↔ provider

Definire:

- data effettiva cessazione: `[DATE]`;
- termine distribuzione/promozione: `[DATE]`;
- rimozione di eventuali materiali/marchi: `[PROCESS]`;
- saldo/fatturazione finale: `[PROCESS]`;
- supporto transitorio: `[PROCESS]`;
- comunicazione agli utenti, se necessaria: `[PROCESS]`.

## Dati della palestra

Se il rapporto commerciale genera contatti, fatture o ticket relativi alla palestra:

- dataset: `[LIST]`;
- base/obbligo di conservazione: `[VALIDATE]`;
- retention: `[TERM]`;
- cancellazione/archiviazione: `[PROCESS]`.

## Dati utenti TheLogBook

- Nessuna cancellazione automatica per cessazione di un eventuale contratto palestra nel modello previsto.
- Gli eventuali utenti mantengono gli strumenti di export e cancellazione account secondo il servizio disponibile.
- Se il servizio TheLogBook stesso viene dismesso, serve una procedura separata con preavviso, export, cessazione sync e cancellazione dei dati secondo basi/obblighi applicabili.

## Scenario processor Art. 28

Se in futuro il provider tratta dati per conto della palestra, sostituire questa sezione con le istruzioni contrattuali Art. 28 su restituzione/cancellazione, incluse copie e backup.

## Evidenza di chiusura

- Contratto: `[ID]`
- Data: `[DATE]`
- Azioni eseguite: `[LIST]`
- Dataset conservati e motivazione: `[LIST]`
- Dataset cancellati: `[LIST]`
- Approvazione: `[ROLE]`
