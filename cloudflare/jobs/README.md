# CF-06 — candidato Worker di cancellazione sanitaria

**Stato:** configurazione candidata **non distribuita e non schedulata**.
Questo manifesto prepara il Worker `health-erasure-worker.mjs` ai test di
compilazione isolata, ma **non** lo attiva su Cloudflare né concede il GO per
cron, account deletion o inattività.

- `wrangler.isolated.jsonc` seleziona solo il database primario isolato e
  il registro recovery indipendente, ciascuno con il proprio ID verificato.
- Niente route, `fetch`, `workers.dev`, URL di preview, secret aggiuntivi
  o `triggers.crons`. Non inserire automaticamente uno schedule.
- Un tick del codice applicativo prova al massimo una riconciliazione del
  cutoff e un passo con lease D1, prima della fase finale atomica. Il Worker
  deve fallire senza dichiarare una cancellazione riuscita se il registro
  indipendente non è disponibile.
- `node scripts/check-cloudflare-erasure-candidate.mjs` verifica il contratto
  del manifesto; `tests/cloudflare/cf06-erasure-worker-config.node.mjs`
  contiene regressioni che rifiutano aperture accidentali.
- I test SQL della suite CF-06 usano dati sintetici e l'intero schema; non
  autorizzano esecuzioni sul DB condiviso o ripristini di segreti reali.

**Prima di un futuro deployment e di un cron:** provare il Worker con la
versione Wrangler adottata dalla CI, schema e quote Cloudflare Free effettivi,
lease e recovery cross-D1 in un ambiente autonomo, kill-switch non distruttivo,
limiti CPU e fallimenti di quota, stato e idempotenza della cancellazione
account Kinde per ultima. Richiedere autorizzazione esplicita per
l'attivazione reale; nessun cambio di IAM, DB o schedule da questa PR.
