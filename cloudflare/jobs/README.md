# CF-06 — candidato Worker di cancellazione sanitaria

**Stato:** configurazione candidata **non distribuita e non schedulata**.
Questo manifesto prepara il Worker `health-erasure-worker.mjs` ai test di
compilazione isolata, ma **non** lo attiva su Cloudflare né concede il GO per
cron, account deletion o inattività.

- `wrangler.isolated.jsonc` seleziona solo il database primario isolato e
  il registro recovery indipendente, ciascuno con il proprio ID verificato.
- Niente route, `fetch`, `workers.dev`, URL di preview, secret aggiuntivi
  o `triggers.crons`. Non inserire automaticamente uno schedule.
- L'ingresso `scheduled` è inoltre **in pausa per default**, anche qualora
  venisse aggiunto per errore un trigger. Esegue la riconciliazione e il passo
  D1 solo quando `CF06_ERASURE_RUN_ENABLED` vale esattamente `enabled`;
  il manifesto candidato non espone questa variabile. Valori mancanti,
  diversi o malformati non leggono neppure i binding D1. Il risultato
  `paused` non è una prova di cancellazione o di avanzamento dei job.
  Rimuovere l'abilitazione ferma le **nuove invocazioni**, non interrompe
  un tick già avviato; i job e i lease restano persistiti per il recupero.
  Questo è un arresto del **processore**, non ancora il kill-switch
  indipendente dell'accodamento per inattività/account deletion. La futura
  abilitazione richiede revisione e autorizzazione specifica, senza
  modificare implicitamente il manifesto isolato. I test sintetici che
  chiamano `runOneHealthErasureStep` non eludono questo gate di runtime.
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
