# Registro fornitori, subprocessori e trasferimenti — TheLogBook

> Compilare da documentazione contrattuale e console correnti. Non dedurre localizzazione, ruolo o meccanismo di trasferimento dal solo repository.

**Perimetro tecnico:** [AGENTS](../../AGENTS.md), [Cifratura](../../.agents/rules/secure-storage.md) e [Telemetria](../../.agents/rules/telemetry-and-privacy.md). Le descrizioni sotto derivano dal contratto repository; ruoli, termini, localizzazioni e retention provider rimangono da verificare e approvare.

## Fornitori runtime correnti

| Fornitore/servizio | Funzione | Dati potenzialmente trattati | Ruolo contrattuale | Localizzazione | Trasferimento extra SEE / garanzia | Retention | Stato |
|---|---|---|---|---|---|---|---|
| Google / Firebase Authentication | Login/account | UID, email, dati provider auth | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Google / Cloud Firestore | Replica cloud cifrata utenti e registri tecnici server-only | Ciphertext business/salute, metadati causali pubblici e dati amministrativi minimi | `[VERIFY_DPA]` | Database: `[VERIFY_LIVE]` | `[VERIFY]` | App + servizio | Aperto |
| Google / reCAPTCHA Enterprise / App Check | Anti-abuse/attestazione | Dati tecnici dispositivo/rete secondo servizio | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Google / Firebase Hosting | Hosting statico frontend/PWA | Request metadata e asset pubblici; nessun dato business utente intenzionale | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Aperto |
| Vercel Functions / Cron | API trusted per lifecycle, consenso/diritti, custodia chiave cloud e manutenzione | Request metadata; payload API minimi; ADK accessibile al server trusted tramite KEK protetta; log tecnici minimizzati, mai chiavi/token/dati salute liberi | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | **Hobby**: runtime log consultabili per 1 ora; altre copie da verificare | Piano verificato; copertura contrattuale aperta |
| GitHub | Repository e CI | Codice, metadati dev, log CI; nessun dato utente intenzionale | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY]` | Dev-only |

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
- **Firestore:** la [location di ogni database è scelta al provisioning e non modificabile](https://docs.cloud.google.com/firestore/native/docs/locations). La regione del database **logbook** non è stata letta da Firestore live: non affermare che i dati siano in UE per l'assenza di un region override nel codice.
- **Vercel Functions:** Vercel documenta la regione predefinita [`iad1` (USA)](https://vercel.com/docs/regions), ma `vercel.json` non esplicita `regions` e **non rappresenta da solo la configurazione live del progetto**. Consultazione diretta del provider il **5 novembre 2026**: il deployment Production `dpl_9GR4nQKokUBiroPDGeYNbcb9ydBb` (commit `5e1a602a4460a0d8253dd129071fa9f081a81c7e`) è `READY` e riporta `regions: ["fra1"]` (Francoforte). La successiva Production `dpl_6BU2K7QJX1BrLhp5DgpKAv9nwEvg`, osservata direttamente il 5 novembre 2026, è `READY`, proviene da `main` SHA `bafc0970b77f9c68ac7be867ad93849468127fc9` e riporta `regions: ["fra1"]`. Verificare gli eventuali flussi cross-border; la regione compute non certifica log e backup. La regione compute non garantisce da sola la residenza di log, metadati e subprocessori.
- **Vercel DPA:** [testo pubblico vigente dal 31 marzo 2026](https://vercel.com/legal/dpa) indica espressamente **Pro ed Enterprise** nel suo campo di applicazione. Il **piano applicabile al progetto è Hobby**, verificato il 5 novembre 2026 sul team Vercel `gnfcreator` e sul progetto Git-linked `logbook`. I [Termini di servizio Vercel (19 ottobre 2026)](https://vercel.com/legal/terms), sezione 11.1, richiamano il DPA per riferimento, ma il campo di applicazione del DPA pubblico specifica Pro ed Enterprise. Questa divergenza richiede conferma documentale da Vercel per Hobby: **non è dimostrata una copertura contrattuale Art. 28 adeguata** ai trattamenti per utenti esterni. Non presumere che un upgrade sia l'unica soluzione.
- **Vercel runtime logs:** la [documentazione](https://vercel.com/docs/logs/runtime) indica visibilità/retention in funzione del piano (**Hobby 1 h, Pro 1 giorno, Pro+Observability Plus 30 giorni, Enterprise 3 giorni**, con opzioni estese). Non confondere la durata dei log consultabili con tutte le eventuali copie, dataset generati dal servizio e backup. Verificare piano, configurazione ed eventuali integrazioni log del tenant.
- **Trasferimenti extra SEE:** il possesso di un DPA o la presenza di SCC nel testo del fornitore non prova da sé le localizzazioni e garanzie applicabili ai flussi del tenant. Registrare provider, dataset, paesi, base Chapter V e prova per servizio prima dell'apertura.

## Verifica specifica del tenant Vercel — 5 novembre 2026

- **Fonte tenant osservata direttamente:** team `gnfcreator` con piano `hobby`, progetto Git-linked `logbook` (`prj_5X9gQKN1vBmSKNuB7to2OwYCaNGV`); deployment Production `dpl_6BU2K7QJX1BrLhp5DgpKAv9nwEvg` `READY`, `githubCommitRef: main`, SHA `bafc0970b77f9c68ac7be867ad93849468127fc9`, compute `fra1`. È un'osservazione puntuale del provider, non una garanzia futura né una prova di residenza per ogni dataset.
- **Condizioni Hobby:** i [Termini Vercel, sezioni 3 e 4](https://vercel.com/legal/terms), prevedono, per i piani Hobby, una clausola di utilizzo di `Your Content` per addestramento/modelli, con possibilità di opt-out tramite impostazioni del team. **Non sono stati verificati il valore dell'opt-out né l'esatto perimetro dei payload di runtime rispetto a `Your Content`**: non affermare che dati degli utenti siano stati usati per training; richiedere verifica contrattuale e dell'impostazione prima di coinvolgerli.
- **Retention:** [documentazione runtime logs](https://vercel.com/docs/logs/runtime) indica una finestra di **1 ora** per Hobby, ma non fornisce il ciclo di vita completo di tutti i log, System Data, backup o subprocessori del tenant. La finestra di consultazione non è una garanzia di eliminazione.
- **Azione necessaria:** ottenere chiarimento applicabile a Hobby su DPA/ruolo, termini e possibili trattamenti di dati personali nei payload API, Model Training, subprocessori, localizzazione e cancellazione. Conservare l'esito documentale nel registro; nessuna modifica automatica di piano o servizio è autorizzata da questa verifica.
