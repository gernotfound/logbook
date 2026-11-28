# CF-08 — Recupero D1: scelta del metodo e prove richieste

**Stato: guida operativa di sicurezza, non procedura autorizzata di restore.**
Perimetro: backend Workers/D1 candidato, registro di revoca indipendente e
chiavi cloud. Fonte degli invarianti: `AGENTS.md`,
`.agents/rules/backup-and-portability.md`,
`.agents/rules/secure-storage.md` e [issue #1062](https://github.com/gernotfound/logbook/issues/1062).
Un esito `consistent-for-diagnostics-only` **non** è un via libera.

## Decisione tecnica sul tipo di recupero

| Caso | Capacità attuale | Condizione di sicurezza |
| --- | --- | --- |
| Rollback D1 completo con Time Travel | Cloudflare sovrascrive **in place** tutto il database e interrompe le query in corso; non è un restore selettivo | **NO-GO su dati condivisi** senza quiescenza verificata, inventario delle scritture successive, ripristino/riproduzione comprovata e autorizzazione specifica |
| Ripristino del solo owner A lasciando B intatto | Non è una funzione di Time Travel; non esiste una pipeline infrastrutturale approvata nel repository | Servirebbe una fonte indipendente, autenticata e coerente per A, con ciphertext/metadata/chiave e prova delle generazioni; verificare B byte-per-byte e lo stato del registro prima/dopo |
| Import di backup volontario sul dispositivo | Percorso di portabilità applicativo distinto dal recovery D1 | Parser/versioni, ownership, consenso attuale e commit/journal di quell'import; non ripristina identità, sessioni, consenso o la KEK |
| Perdita del binding KEK | La D1 conserva soltanto ADK *wrappate*; il nome del secret non ne prova il valore | Soltanto copia indipendente verificata della **stessa** KEK può recuperare le ADK ancora valide; secret assente/diverso: bloccare, non rigenerare |

Il test `diagnostic census cannot prove that a whole-D1 rollback preserved another owner session`
usa lo schema SQL reale e una sessione emessa dal boundary trusted: dopo uno
snapshot, la sessione dell'owner B è presente nella D1 attuale ma manca nello
snapshot precedente. Entrambi gli stati possono superare il censimento dei
*floor* di consenso: quel censimento non confronta sessioni, revisioni sync,
documenti cifrati o ogni altra mutazione di business. Il test è **solo SQLite
locale**, non prova un restore Cloudflare né la conservazione degli ACK.

## Regole di blocco prima di qualsiasi prova provider

1. **GO e isolamento:** identificare account, database ID e binding reali;
   usare soltanto risorse sintetiche isolate esplicitamente autorizzate.
   Nessuna creazione/cancellazione D1, scrittura, Time Travel restore,
   apertura del registro o modifica IAM/KEK derivano da questa guida.
2. **Fonti indipendenti:** attestare identità della D1 applicativa e del
   registro anti-resurrection *fuori* dal database da ripristinare. L'assenza
   o la storia incompleta di un deny/intent/cutoff impedisce il GO. Il
   registro `sealed` non equivale da solo a un blocco durevole di ogni writer.
3. **Quiescenza e causalità:** impedire nuovi commit/lease e verificare che
   siano cessate richieste in volo, job, ACK ambigui e scritture su entrambi
   i database. Una barriera solo applicativa o due scansioni non costituiscono
   uno snapshot atomico cross-D1.
4. **Confini del recupero:** nessun ripristino di credenziali, sessioni,
   consensi revocati, ADK eliminate o dati precedenti ai cutoff terminali.
   Non ricreare owner, receipt o chiavi per riempire assenze. Una revoca o
   cancellazione deve restare efficace anche dopo un rollback.
5. **Integrità e rollback:** mantenere un punto di ritorno indipendente e
   verificare l'intero inventario delle tabelle/trigger/versioni.
   Errore, quota esaurita, checksum/AEAD non verificabile, drift, owner B
   modificato o perdita di testimone comportano stop senza riapertura.
6. **Riabilitazione:** non basta `inspectRestoredD1Census()` positivo.
   Occorre prova esterna di completezza storica, isolamento IAM,
   riconciliazione di tutte le decisioni pendenti, sessioni/consensi attuali,
   chiavi recuperabili e dati degli altri owner invariati. Il protocollo
   di recovery che garantisca tali prove non è ancora implementato.

## Matrice di esercitazione isolata (REST-2 e REST-4)

Questa è una **checklist di prove da eseguire**, non esiti già ottenuti.
Ogni caso registra SHA GitHub, migrazioni realmente applicate, origine,
bookmark, versioni delle chiavi, owner A/B, query/righe fatturate, durata,
errore e stato finale. Dati e segreti soltanto sintetici.

| Scenario | Oracle necessario |
| --- | --- |
| Owner A cancellato o con consenso revocato dopo il bookmark | Nessun recupero dell'accesso o dei ciphertext vietati; il floor indipendente resta monotono |
| Owner B scrive dopo il bookmark | Nessuna perdita silenziosa di documenti, sessioni, receipt o revisioni di B; un semplice census verde non basta |
| Identity-only con intento Kinde/deny non allineati | Rifiuto se intento pendente o decisione non presente nella fonte indipendente; nessun `complete` fittizio |
| Scritture concorrenti, lost ACK e crash in ogni fase | Stop/ripresa idempotente con prova durevole, senza commit parziali o duplicate acknowledgment |
| Sessione scaduta o owner/epoch cambiato | Nessun grant fitness, recupero chiave o replay basato su sessioni storiche |
| KEK assente, diversa, originale; ADK mancante o AEAD alterata | Assente/diversa/corruzione: fail-closed senza reissue. Originale: stessa ADK solo con gate correnti; nessun plaintext nei log |
| Censimento 512/513/1.000 owner e quota D1 rifiutata | Risultato limitato o bloccato con copertura verificata; mai report completo per scansione tronca |

## Capacità Free e obiettivi di recupero (REST-1 e REST-3)

**Fonti Cloudflare consultate il 28/11/2026:**
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
[limiti](https://developers.cloudflare.com/d1/platform/limits/),
[prezzi](https://developers.cloudflare.com/d1/platform/pricing/).
La disponibilità di Time Travel è automatica, con finestra **7 giorni Free**,
senza costo aggiuntivo del restore; non è un backup indipendente a lungo
termine. Cloudflare documenta **10 restore ogni 10 minuti per D1**.
I limiti Free pubblicati includono **10 database/account**, **500 MB per
database**, **5 GB complessivi**, **50 query D1 per invocazione Worker**,
**5 milioni di righe lette/giorno** e **100.000 righe scritte/giorno**.
Al raggiungimento dei limiti giornalieri, le query falliscono fino al reset;
non sono consentiti ACK o esiti di recupero presunti.

- La finestra di 7 giorni è il massimo **orizzonte di ritorno**, non un RPO
  garantito. RPO effettivo = modifiche definitivamente perse rispetto al
  checkpoint ripristinato; RTO = durata osservata fino al ripristino di
  integrità e accesso autorizzato. Entrambi restano da misurare e poi da
  concordare come obiettivi di prodotto; non usare numeri inventati.
- `MAX_OWNERS=512` in `restore-census.mjs` è un limite **diagnostico**.
  La suite verifica 512 ammessi e 513 bloccati; non è un limite di iscrizione.
  Il benchmark di 1.000 utenti richiesto da [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054)
  eccede la copertura attuale. La paginazione futura richiede una prova di
  completezza, snapshot/retry coerenti e budget righe; aumentare soltanto la
  costante sarebbe insicuro. Non anticipare il benchmark B4 completo prima
  del percorso fitness integrato previsto nella #1054.
- Nessun R2, Workers Paid, servizio di backup, retention extra o rotazione
  della KEK è approvato da questo documento. Se il requisito RPO/RTO non
  risultasse soddisfacibile senza nuove risorse, presentare opzioni al PO.
- `jurisdiction=eu` della D1 non prova la regione di elaborazione Workers,
  Kinde, email, log, copie o la conformità GDPR; per retention e valutazioni
  legali fare riferimento al [dossier compliance](../compliance/README.md).

**Condizione di uscita CF-08:** procedura ripetibile su provider isolato con
prove complete su A/B, revoca/cancellazione, chiavi, crash, quote e misure
RPO/RTO; approvazione esplicita distinta da CI e documentazione.
