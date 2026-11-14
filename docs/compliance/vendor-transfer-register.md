# Registro fornitori, subprocessori e trasferimenti — TheLogBook

> Compilare da documentazione contrattuale e console correnti. Non dedurre localizzazione, ruolo o meccanismo di trasferimento dal solo repository. **13/11/2026:** tabella Firebase/Vercel = architettura legacy ancora nel codice, non architettura approvata finale. La nuova D1 `jurisdiction=eu` sintetica non prova collocazione Workers, email, OAuth, log o conformità. Nessun account o dato precedente da migrare secondo il product owner.

**Perimetro tecnico:** [AGENTS](../../AGENTS.md), [Cifratura](../../.agents/rules/secure-storage.md) e [Telemetria](../../.agents/rules/telemetry-and-privacy.md). Le descrizioni sotto derivano dal contratto repository; ruoli, termini, localizzazioni e retention provider rimangono da verificare e approvare.

## Fornitori runtime correnti

| Fornitore/servizio | Funzione | Dati potenzialmente trattati | Ruolo contrattuale | Localizzazione | Trasferimento extra SEE / garanzia | Retention | Stato |
|---|---|---|---|---|---|---|---|
| Google / Firebase Authentication | Login/account | UID, email, dati provider auth | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Google / Cloud Firestore | Replica cloud cifrata utenti e registri tecnici server-only | Ciphertext business/salute, metadati causali pubblici e dati amministrativi minimi | `[VERIFY_DPA]` | Database: `[VERIFY_LIVE]` | `[VERIFY]` | App + servizio | Aperto |
| Google / reCAPTCHA Enterprise / App Check | Anti-abuse/attestazione | Dati tecnici dispositivo/rete secondo servizio | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Google / Firebase Hosting | Hosting statico **storico disabilitato** del sito `thelogbook`, secondo attestazione del proprietario | Request metadata del servizio precedente | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Storico; inventario prima della dismissione |
| Vercel Functions / Cron | API trusted per lifecycle, consenso/diritti, custodia chiave cloud e manutenzione | Request metadata; payload API minimi; ADK accessibile al server trusted tramite KEK protetta; log tecnici minimizzati, mai chiavi/token/dati salute liberi | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | **Hobby**: runtime log consultabili per 1 ora; altre copie da verificare | Piano verificato; copertura contrattuale aperta |
| GitHub | Repository e CI | Codice, metadati dev, log CI; nessun dato utente intenzionale | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Dev-only |
| Cloudflare Workers Static Assets / futuro Worker API | Hosting/frontend candidato e futura API/sessioni | Metadati rete/request, possibili identificativi e log operativi; nessuna salute plaintext prevista | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Static Assets candidato, Worker API NON attivo | 
| Cloudflare D1 sandbox EU | SQL per replica cifrata / future sessioni e control-plane | Solo fixture sintetiche; futura D1 può contenere ciphertext e dati amministrativi minimi, non salute in chiaro | `[VERIFY_DPA]` | `jurisdiction=eu` osservata solo per D1 | `[VERIFY]` | `[VERIFY]` | **Solo test**, non database utenti | 
| Kinde (selezionato, onboarding non completato) | Identità e invio email verifica/OTP/reset, login Google, sessioni provider | Email, identificativi, metadati Auth/rete, token e dati MFA; nessun dato sanitario intenzionale | `[VERIFY_DPA]` | **Region `Europe - Ireland` selezionata secondo screenshot** del business `thelogbook.kinde.com`; nessuna read-back API/provider, app ancora da creare | `[VERIFY]` (email/subprocessori non necessariamente EU) | `[VERIFY]` | **Business in onboarding, non Production**: termini/contratti e flussi da validare |

I fornitori email precedentemente valutati sono **dismessi** e non figurano come fornitori operativi: account dichiarati cancellati dal proprietario, DNS specifici rimossi con prova Cloudflare. Le console e l'eventuale retention non sono state verificate indipendentemente; le evidenze storiche restano nell'[archivio](../operations/transactional-email-provider-evaluation.md).

Google Analytics 4/Firebase Analytics, Vercel Analytics e Speed Insights sono dismessi dal runtime. Le configurazioni storiche ritirate rimangono rintracciabili nella cronologia Git, non nel contratto dei fornitori operativi.

## Checklist per ogni fornitore

- `[ ]` DPA/termini correnti archiviati o linkati internamente.
- `[ ]` Elenco subprocessori verificato.
- `[ ]` Regioni/data location effettive verificate.
- `[ ]` Trasferimenti extra SEE identificati.
- `[ ]` Meccanismo applicabile verificato (adeguatezza/DPF/SCC/altro).
- `[ ]` Eventuali misure supplementari valutate.
- `[ ]` Retention/logging verificati.
- `[ ]` Accessi amministrativi e MFA verificati.
- `[ ]` Contatto security/privacy del fornitore registrato.

## Registro trasferimenti

| Dataset | Origine | Destinazione | Fornitore/subprocessor | Paese | Meccanismo | Misure supplementari | Verificato il |
|---|---|---|---|---|---|---|---|
| `[DATASET]` | `[EU]` | `[COUNTRY]` | `[VENDOR]` | `[COUNTRY]` | `[SCC/DPF/ADEQUACY/OTHER]` | `[MEASURES]` | `[DATE]` |

## Change control

Nuovo SDK, CDN, monitoring, email provider, support tool o analytics = nuova riga prima del rilascio. Se il fornitore riceve dati salute o identificatori utente, rivalutare DPIA, informativa, contratto e base giuridica.

## Verifica documentale pubblica del 5 novembre 2026 (non è attestazione del tenant)

- **Google/Firebase:** [Firebase — Privacy and Security](https://firebase.google.com/support/privacy/) distingue i [**Firebase Data Processing and Security Terms**](https://firebase.google.com/terms/data-processing-terms) dal [Cloud Data Processing Addendum](https://cloud.google.com/terms/data-processing-addendum), applicabile ai servizi GCP governati dai relativi termini. Verificare per **ciascun servizio realmente usato** quale addendum copra l'account/progetto e i subprocessori. L'addendum Cloud prevede per alcuni Customer Data un termine massimo di eliminazione di **180 giorni dopo l'istruzione**, salvo eccezioni; non scambiarlo per la retention dell'archivio applicativo né estenderlo indiscriminatamente a Firebase Auth/reCAPTCHA.
- **Firebase Authentication:** secondo [Firebase Privacy and Security](https://firebase.google.com/support/privacy/), il servizio tratta dati **esclusivamente da data center negli Stati Uniti**; gli IP nei log di autenticazione sono conservati **per alcune settimane**, e dopo la cancellazione dell'utente gli altri dati Auth sono rimossi dai sistemi live/backup **entro 180 giorni**. Sono fatti della policy pubblica del provider, non prova che il singolo progetto abbia eseguito cancellazioni.
- **Firebase App Check:** la stessa fonte precisa che i materiali di attestazione non sono conservati da App Check ma sono inviati al provider di attestazione; i token hanno TTL al massimo 7 giorni, e i token soggetti a replay protection sono conservati fino a 30 giorni. Con reCAPTCHA Enterprise vanno verificati i trattamenti del provider di attestazione.
- **Firestore:** la [location di ogni database è scelta al provisioning e non modificabile](https://docs.cloud.google.com/firestore/native/docs/locations). La [versione storica del registro dei servizi](https://github.com/gernotfound/logbook/blob/8f6625a9100ef96c391a816e5639e8e83ffcc4d5/docs/operations/external-services-register.md) documentava una **verifica del 2 ottobre 2026** del database `(default)` in `europe-west12` (UE), con PITR disabilitato e delete protection attiva. Non è una nuova verifica del tenant né prova la residenza di Firebase Authentication, log, backup, altri database o subprocessori. Evitare inferenze dalla sola assenza di un region override nel codice.
- **Vercel Functions:** Vercel documenta la regione predefinita [`iad1` (USA)](https://vercel.com/docs/regions), ma `vercel.json` non esplicita `regions` e **non rappresenta da solo la configurazione live del progetto**. Consultazione diretta del provider il **5 novembre 2026**: il deployment Production `dpl_9GR4nQKokUBiroPDGeYNbcb9ydBb` (commit `5e1a602a4460a0d8253dd129071fa9f081a81c7e`) è `READY` e riporta `regions: ["fra1"]` (Francoforte). La successiva Production `dpl_6BU2K7QJX1BrLhp5DgpKAv9nwEvg`, osservata direttamente il 5 novembre 2026, è `READY`, proviene da `main` SHA `bafc0970b77f9c68ac7be867ad93849468127fc9` e riporta `regions: ["fra1"]`. La regione compute non dimostra la residenza di log, metadati, backup o subprocessori; verificare i flussi transfrontalieri effettivi.
- **Vercel DPA:** [testo pubblico vigente dal 31 marzo 2026](https://vercel.com/legal/dpa) indica espressamente **Pro ed Enterprise** nel suo campo di applicazione. Il **piano applicabile al progetto è Hobby**, verificato il 5 novembre 2026 sul team Vercel `gnfcreator` e sul progetto Git-linked `logbook`. I [Termini di servizio Vercel (19 ottobre 2026)](https://vercel.com/legal/terms), sezione 11.1, richiamano il DPA per riferimento, ma il campo di applicazione del DPA pubblico specifica Pro ed Enterprise. Questa divergenza richiede conferma documentale da Vercel per Hobby: **non è dimostrata una copertura contrattuale Art. 28 adeguata** ai trattamenti per utenti esterni. Non presumere che un upgrade sia l'unica soluzione.
- **Vercel runtime logs:** la [documentazione](https://vercel.com/docs/logs/runtime) indica visibilità/retention in funzione del piano (**Hobby 1 h, Pro 1 giorno, Pro+Observability Plus 30 giorni, Enterprise 3 giorni**, con opzioni estese). Non confondere la durata dei log consultabili con tutte le eventuali copie, dataset generati dal servizio e backup. Verificare piano, configurazione ed eventuali integrazioni log del tenant.
- **Trasferimenti extra SEE:** il possesso di un DPA o la presenza di SCC nel testo del fornitore non prova da sé le localizzazioni e garanzie applicabili ai flussi del tenant. Registrare provider, dataset, paesi, base Chapter V e prova per servizio prima dell'apertura.

## Verifica specifica del tenant Vercel — 5 novembre 2026

- **Fonte tenant osservata direttamente:** team `gnfcreator` con piano `hobby`, progetto Git-linked `logbook` (`prj_5X9gQKN1vBmSKNuB7to2OwYCaNGV`); deployment Production `dpl_6BU2K7QJX1BrLhp5DgpKAv9nwEvg` `READY`, `githubCommitRef: main`, SHA `bafc0970b77f9c68ac7be867ad93849468127fc9`, compute `fra1`. È un'osservazione puntuale del provider, non una garanzia futura né una prova di residenza per ogni dataset.
- **Condizioni Hobby:** i [Termini Vercel, sezioni 3 e 4](https://vercel.com/legal/terms), prevedono, per i piani Hobby, una clausola di utilizzo di `Your Content` per addestramento/modelli, con possibilità di opt-out tramite impostazioni del team. **Non sono stati verificati il valore dell'opt-out né l'esatto perimetro dei payload di runtime rispetto a `Your Content`**: non affermare che dati degli utenti siano stati usati per training; richiedere verifica contrattuale e dell'impostazione prima di coinvolgerli.
- **Retention:** [documentazione runtime logs](https://vercel.com/docs/logs/runtime) indica una finestra di **1 ora** per Hobby, ma non fornisce il ciclo di vita completo di tutti i log, System Data, backup o subprocessori del tenant. La finestra di consultazione non è una garanzia di eliminazione.
- **Azione necessaria:** ottenere chiarimento applicabile a Hobby su DPA/ruolo, termini e possibili trattamenti di dati personali nei payload API, Model Training, subprocessori, localizzazione e cancellazione. Conservare l'esito documentale nel registro; nessuna modifica automatica di piano o servizio è autorizzata da questa verifica.

## Verifica incrementale del 6 novembre 2026 — issue #824

- **Tenant attuale consultato:** l'integrazione Vercel restituisce ancora il team `gnfcreator` con piano **Hobby** e il progetto `logbook` collegato a `gernotfound/logbook`. La verifica del solo progetto non espone il consenso/opt-out AI né prova quale contratto DPA sia stato accettato.
- **DPA applicabile al piano:** il [DPA pubblico Vercel in vigore dal 31 marzo 2026](https://vercel.com/legal/dpa) esplicita il proprio campo per **Pro ed Enterprise**. Non è stata ottenuta una conferma contrattuale di Vercel che copra il progetto Hobby quale responsabile del trattamento per le richieste utente delle API trusted. **Questo è un blocco pre-utenti esterni**, non un difetto automaticamente correggibile in codice e non implica che un upgrade sia l'unica opzione.
- **AI training: delimitare il perimetro:** il [changelog ufficiale Vercel di marzo 2026](https://vercel.com/changelog/updates-to-terms-of-service-march-2026) specifica per Hobby l'**opt-in predefinito** con opt-out nelle preferenze del team/progetto; elenca *codice, chat degli agenti, dati/errore di build e statistiche aggregate di traffico* come dataset. Non affermare che **payload sanitari di runtime** siano stati impiegati per addestramento: non esiste tale prova dal tenant, e non è stato letto lo stato attuale dell'opzione. Il controllo da eseguire nella dashboard è **Team Settings → Data Preferences**.
- **Conseguenza operativa:** prima di trattare dati personali di utenti esterni, acquisire la conferma scritta su Art. 28, ruoli, subprocessori, trasferimenti e retention delle richieste/log, oltre a registrare l'opzione AI e la relativa applicabilità. Senza queste verifiche **non dichiarare un servizio GDPR-ready**.

## Riscontro tenant incrementale — 6 novembre 2026 (lettura, senza modifiche)

- Connettore Vercel: team `gnfcreator` ancora **Hobby**, progetto `logbook` collegato al repository `gernotfound/logbook`.
- Ultimo deployment backend Production **READY** osservato: `dpl_FTrPS9xrHbhux68JgpZ8fDXuEXv5`, da `main` SHA `afeccc81b835abb0a61cc193d71111fc8e09db74` (PR #826), compute `fra1`. Gli alias osservati includono `logbook-gnf.vercel.app`. I deploy associati a `e99fa514a3c9d216f83e537ba39739448fa69628` e `70c951934b21a3e1d9a545742f88672c9130808d` sono `CANCELED`; il log del secondo indica esplicitamente **Ignored Build Step** per cambiamenti che non richiedono un nuovo backend, non un errore applicativo.
- Non sono stati osservati deployment Vercel del branch `docs/issue-824-consent-consolidation-20261106` alla data del controllo. Questa osservazione non dimostra l'impossibilità di futuri deploy su branch; riesaminare se la configurazione cambia.
- Le fonti pubbliche [DPA Vercel](https://vercel.com/legal/dpa) (campo Pro/Enterprise) e [changelog opzioni AI](https://vercel.com/changelog/updates-to-terms-of-service-march-2026) restano distinte dalla configurazione del tenant. Il connettore letto non certifica **DPA Hobby, preferenza AI, retention integrale o residenza di log e backup**. `fra1` riguarda la regione compute soltanto.
- La [documentazione Firebase](https://firebase.google.com/support/privacy/) descrive trattamenti e retention pubblici ma non certifica la configurazione del tenant. La [versione storica del registro servizi](https://github.com/gernotfound/logbook/blob/8f6625a9100ef96c391a816e5639e8e83ffcc4d5/docs/operations/external-services-register.md) conserva il checkpoint Firestore del **2 ottobre 2026** (`europe-west12`, PITR/backup gestiti disabilitati); occorre una **nuova verifica live** di regione, PITR, eventuali backup e restore prima di presentare tali condizioni come correnti. I trattamenti e le copie degli altri servizi rimangono `[VERIFY_LIVE]`.
