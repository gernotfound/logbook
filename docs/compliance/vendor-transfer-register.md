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
| Vercel Functions / Cron | API trusted per lifecycle, consenso/diritti, custodia chiave cloud e manutenzione | Request metadata; payload API minimi; ADK accessibile al server trusted tramite KEK protetta; log tecnici minimizzati, mai chiavi/token/dati salute liberi | `[VERIFY_DPA]` | `[VERIFY]` | `[VERIFY]` | `[VERIFY_PLAN]` | Aperto |
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

- **Google/Firebase:** [Firebase — Privacy and Security](https://firebase.google.com/support/privacy/) distingue i **Firebase Data Processing and Security Terms** dal [Cloud Data Processing Addendum](https://cloud.google.com/terms/data-processing-addendum), applicabile ai servizi GCP governati dai relativi termini. Verificare per **ciascun servizio realmente usato** quale addendum copra l'account/progetto e i subprocessori. L'addendum Cloud prevede per alcuni Customer Data un termine massimo di eliminazione di **180 giorni dopo l'istruzione**, salvo eccezioni; non scambiarlo per la retention dell'archivio applicativo né estenderlo indiscriminatamente a Firebase Auth/reCAPTCHA.
- **Firestore:** la [location di ogni database è scelta al provisioning e non modificabile](https://docs.cloud.google.com/firestore/native/docs/locations). La regione del database **logbook** non è stata letta da Firestore live: non affermare che i dati siano in UE per l'assenza di un region override nel codice.
- **Vercel Functions:** Vercel documenta la regione predefinita [`iad1` (USA)](https://vercel.com/docs/regions), ma `vercel.json` non esplicita `regions` e **non rappresenta da solo la configurazione live del progetto**. Consultazione diretta del provider il **5 novembre 2026**: il deployment Production `dpl_9GR4nQKokUBiroPDGeYNbcb9ydBb` (commit `5e1a602a4460a0d8253dd129071fa9f081a81c7e`) è `READY` e riporta `regions: ["fra1"]` (Francoforte). I deploy più recenti letti risultano `CANCELED`; verificare la regione di ogni release attiva e gli eventuali flussi cross-border. La regione compute non garantisce da sola la residenza di log, metadati e subprocessori.
- **Vercel DPA:** [testo pubblico vigente dal 31 marzo 2026](https://vercel.com/legal/dpa) indica espressamente **Pro ed Enterprise** nel suo campo di applicazione. **Non è stato verificato un DPA equivalente per Hobby né il piano applicabile al progetto**: se l'account è Hobby, questo è un blocker contrattuale da risolvere prima di usare Vercel per dati personali di utenti esterni, senza presumere che l'upgrade sia l'unica soluzione.
- **Vercel runtime logs:** la [documentazione](https://vercel.com/docs/logs/runtime) indica visibilità/retention in funzione del piano (**Hobby 1 h, Pro 1 giorno, Pro+Observability Plus 30 giorni, Enterprise 3 giorni**, con opzioni estese). Non confondere la durata dei log consultabili con tutte le eventuali copie, dataset generati dal servizio e backup. Verificare piano, configurazione ed eventuali integrazioni log del tenant.
- **Trasferimenti extra SEE:** il possesso di un DPA o la presenza di SCC nel testo del fornitore non prova da sé le localizzazioni e garanzie applicabili ai flussi del tenant. Registrare provider, dataset, paesi, base Chapter V e prova per servizio prima dell'apertura.
