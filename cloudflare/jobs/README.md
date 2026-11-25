# CF-06 — candidato Worker di cancellazione sanitaria

> CF-06 #1404/#1405: moduli candidati account deletion e inattività integrati, con ingresso account application-only candidato, non distribuito/schedulato. Migrazioni 0012–0014 applicative e 0005 recovery ancora separate dalla distribuzione del codice. Il runner account deve provare cleanup owner-scoped (incluso marker attività), floor indipendente e Kinde-last con ACK/readback esatti. Vedere [runbook](../../docs/operations/cloudflare-workers-migration.md).

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
  Questo è un arresto del **processore**, distinto dal controllo candidato
  dell'inattività introdotto in 0013 (paused per default, generazione).
  La selezione dry-run non accoda e avanza di una pagina SQL bounded anche
  quando nessuna riga è eleggibile; il futuro scanner deve distinguere
  pagina senza candidati da fine scansione e ripartire a cambio generazione.
  `recordKindeInactivityErasureIntent` collega atomicamente l'enqueue al controllo, al marker attività, all'epoch e al target; non accoda con sessione corrente e blocca il principal senza inventare una riautenticazione. Lo scanner schedulato non è montato. La futura
  abilitazione richiede revisione e autorizzazione specifica, senza
  modificare implicitamente il manifesto isolato. I test sintetici che
  chiamano `runOneHealthErasureStep` non eludono questo gate di runtime.
- Con il processore esplicitamente abilitato, `CF06_ERASURE_RUN_MODE` seleziona
  un solo percorso per invocazione: `health` (anche se omesso) oppure
  `account-application`. Altri valori mantengono la pausa prima di leggere D1.
  La modalità account invoca il checkpoint persistente 0014 per un solo
  intento durevole, senza scanner, dipendenze Management o prova terminale
  account. Nessuna modalità è configurata nel manifesto. L'alternanza equa
  fra pipeline e il budget del futuro cron restano da collaudare.
- Un tick sanitario prova al massimo una riconciliazione del
  cutoff e un passo con lease D1, prima della fase finale atomica. Il Worker
  deve fallire senza dichiarare una cancellazione riuscita se il registro
  indipendente non è disponibile.
- `node scripts/check-cloudflare-erasure-candidate.mjs` verifica il contratto
  del manifesto; `tests/cloudflare/cf06-erasure-worker-config.node.mjs`
  contiene regressioni che rifiutano aperture accidentali.
- I test SQL della suite CF-06 usano dati sintetici e l'intero schema; non
  autorizzano esecuzioni sul DB condiviso o ripristini di segreti reali.

Il dispatcher candidato `runOneKindeAccountErasureStep` seleziona un solo
intento per tick con cursore UID, riconcilia l'accettazione cross-D1 e
delega ai passi esistenti. Un owner bloccato non deve fermare la scansione;
una riga terminale già presente viene saltata senza attribuire una nuova
ricevuta. `runKindeAccountErasureSweepTick` conserva il checkpoint D1
(0014) con lease ed epoch/token esatti, senza alterare le fence owner.
Un lease scaduto non avanza il cursore; una nuova scansione ritenta il
lavoro. Ingresso application-only collegato nel candidato, non schedulato;
quote, retry/backoff e configurazione
Management restano da integrare e collaudare.

**Prima di un futuro deployment e di un cron:** provare il Worker con la
versione Wrangler adottata dalla CI, schema e quote Cloudflare Free effettivi,
lease e recovery cross-D1 in un ambiente autonomo, kill-switch non distruttivo,
limiti CPU e fallimenti di quota, stato e idempotenza della cancellazione
account Kinde per ultima. Richiedere autorizzazione esplicita per
l'attivazione reale; nessun cambio di IAM, DB o schedule da questa PR.
