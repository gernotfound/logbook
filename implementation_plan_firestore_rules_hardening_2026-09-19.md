# Firestore Rules hardening — piano di implementazione

Data: 2026-09-19
Baseline: `f24485341d33f6475603cbd626f3dc33442c657f`
Rischio: CRITICAL (Security Rules / Firestore boundary)
Stato: approvato dall'utente con richiesta esplicita di procedere.

## Obiettivo

Rafforzare le Firestore Security Rules senza duplicare il parser TypeScript completo e senza modificare le versioni persistite correnti. L'intervento deve preservare l'isolamento owner-scoped esistente, la barriera account-deletion e i normali flussi di sincronizzazione.

## Modifiche previste

1. Aggiungere helper Rules riusabili per validare i payload di telemetria: tipi primitivi, lunghezze massime, context tecnico e shape dei dettagli consentiti.
2. Limitare gli update della telemetria ai campi realmente mutabili; eventi e anomalie devono essere append-only/idempotenti, mentre gli errori possono aggiornare solo i contatori/timestamp previsti dal dedupe.
3. Vincolare `details` della telemetria a un insieme esplicito di chiavi tecniche note, con tipi e limiti di dimensione, senza cambiare il contratto applicativo dei dati utente.
4. Aggiungere test emulator adversariali per payload malformati, campi non consentiti, update non autorizzati e limiti di dimensione.
5. Aggiornare i test statici Rules senza indebolire invarianti esistenti.

## Non-obiettivi

- Non duplicare integralmente `parseSyncMeta()` nelle Security Rules.
- Non cambiare Data Schema 1, Sync Protocol 1, Local Envelope 4 o Backup Schema 3.
- Non cambiare l'architettura account-deletion o il catalogo globale.
- Non modificare in questo lotto la semantica della telemetria applicativa o la Privacy Policy: eventuale ulteriore minimizzazione dei dettagli resta separata dal boundary Rules.
- Non introdurre refactoring non pertinenti.

## Validazione

- Test mirati Firestore emulator durante sviluppo.
- Gate canonico finale `npm run verify:m8` tramite workflow `Milestone Verification` / job `Canonical Verification` sull'esatto HEAD candidato.
- Review finale del diff.
- Deploy esplicito di `firestore.rules` richiesto dalle regole repository, se disponibile con gli strumenti/permessi della sessione.
- Dopo merge: verificare SHA effettivo su `main`, CI post-merge e deployment Vercel production corrispondente.

## Rollback

Il rollback consiste nel ripristino del commit precedente delle Rules. Poiché non vengono cambiate versioni persistite né schema dati applicativo, non è prevista migrazione dati.
