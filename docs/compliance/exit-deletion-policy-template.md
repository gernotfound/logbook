# Exit, cessazione e cancellazione — template LogBook

> Definisce il comportamento alla fine del rapporto commerciale senza confondere il contratto palestra con il rapporto dell'utente con LogBook.

## Principio corrente

Nel modello pilot la palestra non possiede né amministra gli account LogBook degli iscritti. La cessazione del contratto B2B non comporta automaticamente la cancellazione degli account o dei dati dei singoli utenti.

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

## Dati utenti LogBook

- Nessuna cancellazione automatica per cessazione del contratto palestra nel modello corrente.
- Gli utenti mantengono gli strumenti di export e cancellazione account secondo il servizio disponibile.
- Se il servizio LogBook stesso viene dismesso, serve una procedura separata con preavviso, export, cessazione sync e cancellazione dei dati secondo basi/obblighi applicabili.

## Scenario processor Art. 28

Se in futuro il provider tratta dati per conto della palestra, sostituire questa sezione con le istruzioni contrattuali Art. 28 su restituzione/cancellazione, incluse copie e backup.

## Evidenza di chiusura

- Contratto: `[ID]`
- Data: `[DATE]`
- Azioni eseguite: `[LIST]`
- Dataset conservati e motivazione: `[LIST]`
- Dataset cancellati: `[LIST]`
- Approvazione: `[ROLE]`
