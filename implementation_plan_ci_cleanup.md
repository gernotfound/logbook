# Piano cleanup trigger CI M8 obsoleto

Data: 15 settembre 2026. Baseline: `8bee2fa28f51a60327537a960c4cb146c6e60c3c`.
Stato: approvato dall'utente con richiesta di procedere.

## Obiettivo

Rimuovere il trigger push ormai obsoleto `feat/m8-domain-operations-v4` dal workflow canonico e riallineare il checker CI e la regola normativa, senza cambiare il comportamento del gate su `main` e sulle pull request verso `main`.

## File coinvolti

- `.github/workflows/verification.yml`
- `scripts/check-ci-contract.mjs`
- `.agents/rules/ci-verification.md`

## Modifiche

1. Nel workflow, lasciare come trigger push soltanto `main`.
2. Nel contract checker, sostituire il requisito del branch M8 con il divieto esplicito di trigger milestone obsoleti.
3. Aggiornare il messaggio finale del checker per descrivere il contratto corrente.
4. Rimuovere dalla regola CI la nota che dichiara ancora presente il trigger M8 morto.

## Invarianti da preservare

- PR verso `main` continuano ad avviare `Milestone Verification`.
- Push a `main` continuano ad avviare il workflow.
- `Canonical Verification` resta il job/check stabile.
- exact-head checkout e runtime SHA guard restano invariati.
- `permissions: contents: read` resta invariato.
- nessun secret production viene introdotto.
- `npm audit --audit-level=high` e `npm run verify:m8` restano invariati.
- concurrency e failure propagation restano invariati.

## Verifica

- eseguire `npm run test:ci-contract` sul candidato;
- eseguire `npm run verify:m8` come gate canonico completo;
- verificare su GitHub Actions l'exact HEAD della PR e il job `Canonical Verification`;
- controllare che il diff resti confinato ai file sopra più questo piano.

## Rischi e rollback

Rischio principale: rendere il checker non coerente col workflow e far fallire `verify:m8`, oppure rimuovere per errore un trigger ancora necessario. Il branch M8 non esiste più e la policy corrente richiede soltanto PR verso `main` e push a `main`; il rollback consiste nel revert del piccolo commit CI senza effetti su dati, runtime applicativo o Firestore.
