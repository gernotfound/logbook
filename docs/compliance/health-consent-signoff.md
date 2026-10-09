# PR #301 — decisioni privacy e autorizzazione al rilascio della revoca salute

> **Stato: BLOCCATO / NON APPROVATO.** Documento preparatorio per il product owner e il professionista privacy. Non e' un parere giuridico, un'autorizzazione al trattamento, una DPIA, una dichiarazione di conformita' o un certificato di cancellazione.
>
> Baseline esaminata: GitHub main `63039597b693aa88c16797890015c7873360a276`; PR #301, candidato tecnico iniziale `89cb37cae0f8bb143ef7346c2e8e4f32ddb37b0b` (9 ottobre 2026). Riconvalidare gli SHA prima dell'approvazione definitiva.
>
> **Guardrail:** non eseguire merge, deploy, migrazione manuale o cancellazione di dati reali finche' i gate legali, di prodotto e di provider non siano chiusi. Non pubblicare segreti o dati di contatto personali nei documenti di lavoro del repository pubblico.

## 1. Funzione approvata come comportamento di prodotto, non ancora approvata legalmente

Il product owner ha scelto la soluzione A: revoca del consenso relativo ai dati salute, sospensione immediata di workout/nutrizione/misurazioni, proposta facoltativa di backup JSON **prima** della conferma, cancellazione dei dati di tracciamento non altrimenti giustificati e mantenimento dell'account di accesso. La cancellazione dell'account e' un percorso distinto.

**Osservato nel codice candidato, non in Production:** richiesta con token Firebase/App Check; marker autorevole server-only, barrier Firestore e protezioni locali/cross-device; eliminazione paginata con lease/retry; cron giornaliero con fairness e segnali tecnici; blocco su collection inattese; preservazione Firebase Auth. Le suite di test, la CI e l'Emulator non dimostrano l'efficacia della cancellazione nei provider live. Un dispositivo che resta offline non puo' essere raggiunto e ripulito dal server.

**Decisioni non autorizzate:** non introdurre ri-consenso implicito; non conservare indefinitamente contenuti salute dopo la revoca senza altra valida base; non dichiarare che backup/provider/dispositivi offline siano stati gia' ripuliti; non interpretare consenso Art. 9 come base Art. 6 per ogni finalita'.

## 2. Informazioni indispensabili dal titolare

| Campo | Dato/decisione reale necessaria | Stato |
|---|---|---|
| Titolare | Identita' effettiva: persona fisica o soggetto giuridico, denominazione e recapito richiesto per informativa Art. 13 | **MANCANTE** — `[NOME / RAGIONE SOCIALE]`, `[INDIRIZZO]` nella PrivacyPolicy |
| Contatto per i diritti | Canale email privacy pubblico controllato e funzionante, con responsabile della gestione e procedura di risposta | **MANCANTE** — `[EMAIL PRIVACY]` / `[PRIVACY_EMAIL]` |
| Ruoli | Chi decide finalita' e mezzi; eventuale rapporto con palestre: distributore, responsabile, contitolarita' | **DA VALIDARE** — `controller-role-decision.md` |
| Popolazione | Solo maggiorenni? Geografie, dimensione pilot, coinvolgimento di palestre/coach e loro accesso reale | **DA CONFERMARE** |
| DPO / referenti | Valutare obbligo DPO e nominare referenti operativi; non presumere che sia obbligatorio o escluso | **DA VALUTARE** |

Inserire nei documenti pubblici solo gli estremi che devono esserlo per trasparenza; gestire documenti, firme e recapiti personali non pubblici fuori dal repository pubblico.

## 3. Matrice delle finalita' e dei dati da validare

| Finalita' / dati | Base proposta da verificare | Verifica professionale |
|---|---|---|
| Autenticazione, erogazione e sincronizzazione degli account | Art. 6(1)(b) indicato nell'informativa, verificarne la necessita' per ogni sotto-finalita' | **APERTO** |
| Allenamento, nutrizione, misure, sonno, dolore e dati potenzialmente sanitari | Per i dati qualificabili Art. 9, consenso esplicito Art. 9(2)(a); individuare anche base Art. 6 e verificare liberta'/specificita' del consenso | **CRITICO / APERTO** |
| Registrazione della revoca e marker server-only che impedisce scritture da vecchi client | Individuare finalita', base Art. 6, soggetti autorizzati e durata minima giustificabile del marker | **CRITICO / APERTO** |
| Tracciamento tecnico errori su Sentry | Legittimo interesse Art. 6(1)(f) dichiarato; LIA, minimizzazione, accessi, retention e validazione provider | **APERTO** |
| GA4 opzionale | Consenso separato Art. 6(1)(a), verificare configurazione, cookie/identificatori, revoca e diritti applicabili | **APERTO** |
| Account deletion, ricevuta tecnica e richieste diritti | Verificare obblighi/diritti, minimizzazione, tempi, prova del processo e retention dei record | **APERTO** |

La richiesta di consenso dati salute nel percorso di accesso va valutata anche ai sensi dell'Art. 7(4): le funzioni realmente necessarie e le conseguenze del rifiuto devono essere giustificate. I checkbox/flag applicativi non costituiscono da soli una prova legale sufficiente: definire modalita' di raccolta e prova del consenso, versione dell'informativa, finalita', data e revoca.

## 4. Matrice delle cancellazioni e della retention

| Sistema/dato | Stato del candidato | Decisione o prova che manca |
|---|---|---|
| `users/{uid}` root + raccolte private Firestore | Eliminazione di contenuti business, preserving minimised legal consent; verifica anche discendenti senza documento genitore | Mappare esattamente ogni dato conservato e ogni eccezione Art. 17; verificare Rules/indici **live** |
| IndexedDB, localStorage e journal sul dispositivo corrente | Pulizia owner-scoped e sospensione delle scritture con regressioni | Smoke browser/dispositivi Production e failure path, autorizzati solo dopo gate |
| Altri dispositivi, tab obsolete e device offline | Marker cloud e barriere; pulizia locale quando apprendono la revoca | Rischio residuo offline non eliminabile da remoto; testo trasparente e procedura coerente |
| Marker `health_consent_revocations` dopo `complete` | Conservato per impedire resurrezione da vecchi client | Stabilire base Art. 6, minimizzazione e retention/criterio; non cancellarlo a caso |
| Firebase Auth | **Conservato** dopo sola revoca | Informare chiaramente; account deletion separata |
| Backend Vercel / provider / log | Diagnostica tecnica; nessuna eliminazione automatica dimostrata di log provider | Evidenze retention/policy accessi e contratti, minimizzazione |
| Firestore backup, PITR e restore | Stato del provider non osservabile dal repository | Verificare se attivi, ciclo di vita, strategia restore senza riattivare dati cancellati |
| Sentry / GA4 e dati eventualmente gia' trasmessi | Revoca locale non prova cancellazione retroattiva sul provider | Verificare trattamento effettivo, DPA, retention, eventuali richieste di cancellazione |
| Job `blocked` o `failed` | Retry automatico per failed; blocked richiede intervento tecnico revisionato | Responsabile escalation, controllo esecuzioni, SLA realistico e approvazione prima di interventi distruttivi |

Prima di promettere una durata di conservazione concreta, provarne la corrispondenza con provider, contratti e automatismi reali. La cancellazione cloud puo' richiedere piu' cicli: non presentare `revoked` come `erased`.

## 5. Responsabilita' e DPIA

- Completare `processing-record-template.md` (RoPA, valutando applicabilita' e deroghe senza presumere esenzione solo perche' il pilot e' piccolo).
- Completare e validare `dpia-screening-template.md`; se il rischio e' elevato, una DPIA completa deve precedere il trattamento pertinente.
- Completare `vendor-transfer-register.md`: DPA, eventuali subprocessori, regioni effettive, trasferimenti extra SEE e relative garanzie per Google/Firebase, App Check/reCAPTCHA, Vercel, Sentry e GA4.
- Completare `retention-schedule.md`, `data-subject-rights-procedure.md`, valutazione DPO e LIA Sentry.
- Distinguere decisioni privacy del titolare, review professionale e prove tecniche dei provider; **nessuna e' sostituibile dalle altre**.

## 6. Sequenza di rilascio — solo dopo approvazione

1. Identita'/recapiti pubblici, ruoli, basi Art. 6/9, testi di consenso/informativa, retention ed eventuali eccezioni Art. 17 approvati. Verificare che la versione `LEGAL_VERSIONS.privacy` sia incrementata quando l'informativa viene modificata materialmente.
2. DSR e responsabilita' assegnate, RoPA/valutazione DPIA/LIA e fornitori verificati; registrare la decisione di go-live senza credenziali o documenti personali nel repository.
3. Riesaminare PR #301 rispetto al vero `main`; revisionare diff, Rules, indici, test, failure path e gate exact-SHA. Prima di abilitare il cron con la query ordinata, garantire l'indice composito `health_consent_revocations(eraseStatus, eraseUpdatedAt)` nello stato **READY**. Coordinare i deploy perche' l'indice non e' istantaneo.
4. Solo dopo gate: squash merge su `main`, verifica nuovo SHA/CI postmerge, riconciliazione Firestore Rules/indici tramite provider, Firebase Hosting Production e Vercel backend da `main`. Non usare branch Preview proibite come scorciatoia.
5. Eseguire smoke su utenti/fixture autorizzati, verificando revoca, local/cloud status, nessun reimport da client stantii, cron Vercel e alert di `blocked/failed`; non toccare dati personali reali senza mandato.
6. Archiviare la prova minima del rilascio e assegnare monitoraggio periodico dei job; mantenere la PR in Draft e non dichiarare il rilascio completato se un gate fallisce.

## 7. Registro della decisione (da completare)

- Titolare e contatto privacy: **NON CONFERMATI**
- Responsabilita' professionale su Art. 6/9, consenso, Art. 17, retention: **NON CONFERMATA**
- RoPA, DPIA screening, LIA, DPO: **NON APPROVATI**
- Fornitori/trasferimenti e backup/provider: **NON VERIFICATI COMPLETAMENTE**
- Indice/Rules Firebase live, Vercel cron/monitoraggio e browser smoke: **DA VERIFICARE DOPO GATE**
- Decisione di rilascio del product owner: **NON ASSUNTA**
- Autorizzazione a cancellare dati reali esistenti: **NON CONCESSA**

**Risultato: NON MERGERE / NON DISTRIBUIRE.** Un via libera tecnico non autorizza a presumere identita', basi giuridiche o cancellazione certificata.

## Fonti primarie per la review professionale

- [GDPR, Reg. (UE) 2016/679, testo ufficiale](https://eur-lex.europa.eu/eli/reg/2016/679/oj/?locale=it) — artt. 5–7, 9, 12–13, 17, 24–25, 28, 30, 32–35.
- [EDPB Linee guida 05/2020 sul consenso](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_it).
- [Garante Privacy — Principi del trattamento](https://www.garanteprivacy.it/home/principi-fondamentali-del-trattamento).
- [Garante Privacy — App e dispositivi fitness tracker](https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/9968193).
