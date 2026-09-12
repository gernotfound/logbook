# Piano di correzione dell'audit LogBook

Data: 10 settembre 2026. Baseline: `5a04e97a367dc2245f239addacb2f475b1231452`.
Stato: **approvato dall'utente il 10 settembre 2026; implementazione in corso**.

## Obiettivo e criterio di completamento

Gestire tutti i finding LB-01â€“LB-26 di `audit_logbook_2026.md`, oltre ai difetti di tooling/documentazione e alle verifiche aperte elencate nell'audit. Ogni finding avrÃ  un esito con modifica, test e prova, oppure una motivazione verificabile se l'ipotesi risulta smentita. Nessun finding sarÃ  chiuso sulla sola base della compilazione.

L'audit resta il documento storico della baseline. Il consuntivo delle correzioni sarÃ  separato. La richiesta copre implementazione e verifiche locali/isolate; pubblicazione e modifiche alle dashboard saranno presentate come operazioni concrete dopo la validazione. Non verranno usati account reali o dati di produzione per test distruttivi.

Il repository Ã¨ ancora alla baseline, con il solo audit non tracciato. Prima dell'implementazione creare un branch `codex/audit-remediation`, preservando audit e piano. Nessun reset di modifiche dell'utente.

## Decisioni di progetto proposte

### 1. Persistenza e identitÃ 

- Distinguere modifica in memoria, commit locale e conferma remota; il feedback ottimistico non equivale a un salvataggio durabile.
- Serializzare le operazioni locali per utente. Cache e operazioni pendenti vengono scritte atomicamente in IndexedDB, con versione del formato, owner, revisione locale e baseline necessaria alla riconciliazione.
- Separare guest e utenti autenticati. Una vecchia cache senza owner non viene attribuita automaticamente all'account corrente: conservarla come recuperabile e richiedere una scelta esplicita solo quando il proprietario non Ã¨ determinabile.
- Incrementare un'epoch a ogni cambio autenticazione/reset e verificarla ai confini asincroni; callback vecchi non modificano store, baseline o stato di sincronizzazione nuovi.
- Conservare il contratto pubblico DB a risultati espliciti. Le azioni store rigettano su persistenza fallita/rifiutata; `local-pending` significa copia locale verificata, non successo cloud.

### 2. Un solo percorso di replica

- Introdurre una coda applicativa durevole per UID e usare Firebase SDK come unico canale di scrittura dei dati utente. Eliminare il replay REST indipendente dal service worker.
- Una sola operazione attiva per owner, completamenti condizionati a operation ID/revisione. Timeout non cancella una Promise sottostante: conservare il suo esito e rendere idempotente il retry.
- Per modifiche concorrenti, leggere il documento remoto in transazione e applicare soltanto i cambiamenti intenzionali rispetto alla baseline. Un valore remoto uguale al risultato atteso Ã¨ giÃ  applicato; un valore diverso sia dalla base sia dal risultato Ã¨ un conflitto da conservare.
- Le transazioni richiedono rete: offline si conferma la copia locale e si mantiene la coda; replay su connessione/foreground/riapertura. **A pagina chiusa non si promette la replica remota automatica del SW.** L'app resta utilizzabile offline.
- Migrare le vecchie code senza eliminarle alla semplice lettura. Non riprodurre token/payload di proprietario ambiguo. Gestire le pending writes SDK giÃ  esistenti prima del passaggio al nuovo writer.
- Conservare inizialmente i path e formati cloud esistenti. Se emergesse la necessitÃ  di nuovi metadati cloud, aggiornare tutti i file canonici e documentare il formato prima di implementarli.

### 3. Dati parziali, merge e conflitti

- Registrare quali mesi sono completi. Un mese mai letto non equivale a un mese vuoto e non puÃ² essere sostituito o eliminato per assenza nello snapshot locale.
- Esprimere upsert e cancellazioni per ID/data nella coda, conservando base e valore desiderato. La transazione fonde cambiamenti indipendenti; per record modificati da entrambe le parti preserva entrambe le alternative invece di scegliere silenziosamente.
- Hydration sostituisce i record non sporchi nei mesi completi; riapplica le operazioni locali pendenti senza resuscitare cancellazioni remote. Conserva i mesi non caricati.
- Il merge guest mantiene la policy guest definita da AGENTS, ma usa una migrazione durabile e non un reload parziale che scarta il risultato.
- Aggiungere caricamento progressivo dello storico e acquisizione completa paginata per il backup. Mostrare chiaramente quando il dataset disponibile Ã¨ parziale.
- Non dedurre da vecchi client una garanzia di concorrenza che non possiedono: prima del rilascio verificare la coesistenza con la versione precedente e il passaggio PWA. Un client vecchio puÃ² continuare a scrivere snapshot completi; questo Ã¨ un vincolo di rollout, da non nascondere.

### 4. Backup, migrazioni e cancellazione

- Un formato JSON versionato con owner, completezza, UserData e stato locale recuperabile. Importare anche backup ordinari/d'emergenza precedenti.
- Distinguere ripristino ed importazione incrementale; anteprima delle collisioni, nessuna mutazione in place, ricalcolo dei derivati e commit locale prima della conferma.
- I consensi importati possono essere conservati come dati storici ma non aggirano l'accettazione richiesta per identitÃ /versione correnti.
- Migrazioni non distruttive: preservare il dato originale fino a successo verificato; scarti/quarantena devono essere recuperabili. Non tentare di ricostruire dati giÃ  persi inventandoli.
- Cancellazione account: reautenticazione prima di eliminare, arresto dei writer, query/batch paginati con esito esplicito, verifica dei residui, rimozione Auth solo dopo bonifica confermata. In caso di parzialitÃ  conservare identitÃ  e capacitÃ  di ripresa, con messaggio chiaro. Nessuna falsa promessa di atomicitÃ  tra Firebase Auth e Firestore.

## Lotti di implementazione

Ogni lotto comprende test mirati durante lo sviluppo e la sequenza lint â†’ test â†’ build â†’ E2E prima di dichiararlo pronto. Non servono nuove approvazioni per ciascun lotto giÃ  compreso nel piano approvato; eventuali cambi sostanziali al protocollo o azioni di produzione verranno resi reviewabili prima di procedere.

| Lotto | Finding | Implementazione e file principali | Accettazione |
|---|---|---|---|
| A â€” Prove affidabili | LB-21/22 | `package.json`, lockfile, `vitest.config.ts`, nuovo config stress, `vite.config.ts`, `playwright.config.ts`, `tests/setup.tsx`, test Rules, `firebase.json`, workflow CI. Separare test con DB reale/emulato dai mock UI; stress con include reali; correggere teardown preview e gate coverage effettivo | Tutti i file stress selezionati; 60 fallimenti triagiati per contratto senza disattivare le invarianti; Rules emulator con anonimo/A/B e payload malformati; errore/soglia non soddisfatta causa exit non zero |
| B â€” Recovery e validazione | LB-08/09 | `src/lib/export.ts`, `schema.ts`, `schemas/*`, `types.ts`, `useSettings.ts`, `SettingsView.tsx`, test export/schema; moduli dedicati per formato/migrazioni se utili | Round-trip completo e legacy; 501 elementi conservati; numeri finiti; sonno numerico migrato; ID coerenti; import fallito lascia invariato il dato precedente |
| C â€” Commit locale e sessioni | LB-01/02/06/13 | Nuovi moduli storage/sync, `createDataSlice.ts`, `createSyncSlice.ts`, `useAppStore.ts`, `main.tsx`, `AuthContext.tsx`, `db_core.ts`, `GlobalDialog.tsx` | Nessun synced dopo errore IndexedDB; dirty immediato; logout attende la revisione corrente; vecchi completamenti non attraversano owner/epoch; conflitto recuperabile dopo rejection |
| D â€” Replica e storico | LB-03/04/05/07 | `db.ts`, `db_training.ts`, `db_nutrition.ts`, `merge.ts`, `AuthContext.tsx`, `sw.ts`, moduli coda/transazioni, consumer storico/grafici e backup | Mese remoto con 31 giorni sopravvive all'import di uno; A/B convergono su modifiche indipendenti; conflitti espliciti sulle collisioni; cancellazioni non risorgono; guest di 12 mesi preservato; timeout/retry idempotenti |
| E â€” Workout, alimenti, date e bozze | LB-11/12/14/15/16/20 | `useWorkoutSession.ts`, `createWorkoutSlice.ts`, `useNutritionMeals.ts`, `NutritionFoodArchive.tsx`, `useNutritionPlanning.ts`, `calc/planning.ts`, `useNutritionMeasurements.ts`, `useLocalStorage.ts`, `WorkoutTimer.tsx`, navigatori Nutrition/Data, utility date/draft | Creazioni con ID stabile, porzioni distinte; fine workout una sola volta anche dopo retry; rimozione locale sincrona; date corrette nei fusi/DST; zero ON conservato; fine ciclo coerente; bozze per owner/data e input non sovrascritti |
| F â€” Catalogo | LB-19 | `catalogService.ts`, `deltaResolver.ts`, handler restore, integrazione bootstrap/store e `scripts/seed-catalog.mjs` | Cache vuota non considerata catalogo completo; aggiornamento atomico nello store; restore persiste; omonimi con ID distinti conservati; seeding vuoto bloccato, senza eseguirlo su produzione |
| G â€” Account e telemetria | LB-10/17/18 | `db_account.ts`, `useSettings.ts`, `firebase.ts`, `telemetryHub.ts`, `telemetrySanitizer.ts`, `PrivacyPolicy.tsx`, guide telemetria e lifecycle | Cancellazione parziale segnalata/riprendibile; Auth non eliminato con residui; revoca SDK immediata e resistente alle race; niente nomi liberi nei dettagli; purge/coda per UID; versione telemetria corretta |
| H â€” AccessibilitÃ  e aggiornamenti | LB-23/24 | `GlobalDialog.tsx`, `useDialogStore.ts`, `ReloadPrompt.tsx`, `BufferedInput.tsx`, `App.tsx`, `main.tsx`, CSS e test browser | Focus iniziale/trap/ritorno, Escape coerente, background inert; update differibile; flush e commit locale prima di reload; niente loop preload; zoom assistivo preservato |
| I â€” Performance e manutenzione | LB-25/26 e debito Â§7 | `calc/analytics.ts`, `useAnalyticsWorker.ts`, liste Data/archivio, storage/diff, package/lockfile, script check/icone, documentazione | Benchmark ripetibili 1/5/10 anni; filtro temporale anticipato, lookup per ID, meno copie/riscritture; virtualizzazione solo dove utile; warning lint risolti motivatamente; catena vulnerabile aggiornata con versioni supportate |

I nuovi moduli e test avranno responsabilitÃ  ristrette; i nomi definitivi saranno scelti dopo aver verificato le utility esistenti. Le aree che attraversano piÃ¹ lotti vengono chiuse solo quando passa il test dell'intero flusso.

## Dipendenze e sicurezza

- Aggiungere solo dipendenze di sviluppo necessarie agli emulatori/test, con versione verificata e lockfile aggiornato. Verificare Java e strumenti Firebase prima di scegliere il runner.
- Rivalutare l'advisory UUID corrente e una versione compatibile della catena amministrativa. Evitare downgrade major automatici, override non verificati e aggiornamenti generalizzati estranei alla correzione.
- La migrazione a Vitest 5 Ã¨ opzionale: eseguirla solo se utile a risolvere un impedimento dimostrato; una versione nuova non Ã¨ di per sÃ© una correzione dell'audit.
- Per LB-22 avviare prima test comportamentali sulle Rules attuali. Se la validazione richiede modifiche a `firestore.rules`, preparare patch retrocompatibile e test prima del deploy richiesto da AGENTS. Il target e l'azione di deploy saranno presentati esplicitamente; nessun deploy implicito insieme a un test.
- Ispezionare le protezioni GitHub/Vercel in sola lettura quando accessibili. Gli eventuali required checks e Deployment Checks da applicare saranno indicati con i nomi effettivi dei job dopo la verifica della CI.

## Matrice di test obbligatoria

1. **Storage reale:** IndexedDB nel browser, quota/errori simulati al confine, riapertura dopo commit locale e prima del commit remoto. Il mock che restituisce synced non vale come prova.
2. **Concorrenza:** due contesti browser sullo stesso account, due account differenti, completamenti invertiti, logout multi-tab, import durante fetch, migrazione guest durante modifica.
3. **Rete:** offline prima di avvio, durante save, timeout seguito da commit tardivo, reconnect, SW assente, token/App Check rifiutati in ambiente di prova.
4. **Recovery:** backup completo 24 mesi, JSON d'emergenza, schema legacy, array oltre soglia, ID duplicati e dati corrotti; nessun dato silenziosamente azzerato.
5. **Dominio:** double submission, porzioni omonime, eliminazione/retry, 0/7 ON, durata ciclo non multipla di sette, mezzanotte, fusi a ovest di UTC e DST.
6. **Sicurezza:** Rules emulator, isolamento delle code, fallimento cancellazione per ogni query/batch; payload telemetria e revoca analytics verificati.
7. **UI/PWA:** tastiera/focus, viewport 320 px, upgrade fra due build, input focused e workout attivo, cold start offline con asset giÃ  installati. iOS/VoiceOver reale resta una verifica assistita se non Ã¨ disponibile un dispositivo controllabile.
8. **Performance:** fixture deterministiche, warm-up e piÃ¹ misure; confronto prima/dopo per parsing, persistenza e grafici. Nessun budget dichiarato raggiunto sulla base del solo desktop se riguarda iOS.

Comandi finali: `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`, `npm run test:stress`, suite emulator/coverage aggiunte, audit prod e dev, `npm run analyze` dopo nuove dipendenze. Registrare durate, quantitÃ  di test e impedimenti; non cancellare o indebolire test per nascondere un fallimento.

## Rischi e rollback

| Rischio | Contromisura e rollback |
|---|---|
| Attribuzione errata della cache legacy | Non assegnare owner senza evidenza; conservare originale, consentire export/import esplicito; migrazione copy-on-write |
| Retry o cambio versione che duplica scritture | ID/revisione e confronto base/remoto/desiderato; test transazione e completamento tardivo; non riattivare contemporaneamente writer REST e SDK |
| Client precedenti ancora attivi | Prova di compatibilitÃ  e sequenza di aggiornamento prima del rollout; limite documentato se non imponibile lato server |
| Migrazione schema distruttiva | Snapshot originale e quarantena; lettori compatibili; nessuna cancellazione automatica degli archivi di recovery |
| Rules piÃ¹ restrittive rifiutano dati legacy | Fixture legacy/emulator prima del deploy; copia delle Rules precedenti e rollback del solo cambiamento se necessario |
| Cancellazione interrotta | Conservare account e stato di avanzamento; ripresa idempotente; non esiste rollback magico di dati remoti giÃ  cancellati |
| Refactoring performance modifica risultati | Confronto degli output su fixture prima/dopo; separare ottimizzazioni dai cambi di formula; revert del modulo senza migrare dati |
| Aggiornamento dipendenze rompe tooling | Lockfile precedente e aggiornamenti circoscritti; test admin isolati e verifica bundle |

Rollback del codice non significa rollback dei dati: dopo una migrazione locale non riportare l'app a un writer che ignora il nuovo formato e ne distrugge la coda. Conservare compatibilitÃ  di lettura o procedura di export/recovery prima di ritirare una versione.

## Informazioni eventualmente necessarie piÃ¹ avanti

La correzione locale puÃ² partire senza altre informazioni. Per completare le verifiche esterne potranno servire accesso a un progetto Firebase di prova, conferma del target di deploy Rules, accesso alle dashboard e una prova guidata su iOS. Saranno richiesti quando la relativa verifica sarÃ  pronta, continuando nel frattempo gli altri lotti. Nessuna password o chiave privata va incollata nella conversazione.

# Piano di implementazione LogBook - Miglioramenti UI e UX

Data: 12 settembre 2026

## 1. Vincoli di progetto e baseline
L'intervento verrà eseguito sul branch dedicato `feat/ui-workout-guest-flow` per separare queste modifiche dall'audit in corso.
La baseline da rispettare è:
* React + Vite + TypeScript.
* CSS nativo centralizzato in `src/styles/global.css`; nessun Tailwind.
* `lucide-react` per l'iconografia.
* Zustand come stato operativo.
* Persistenza locale/offline prioritaria.
* `GlobalDialog` per alert e conferme.
* Touch target principali di almeno 44×44 px.
* Input/select/textarea a 16 px per evitare lo zoom iOS.
* Sentence case italiano per tutti i testi UI.
* Nessuna modifica strutturale senza piano approvato.
* Dopo ogni modifica: lint → test → build → E2E.
* Le nuove interfacce create nelle Fasi 1, 2 e 3 **devono già rispettare** il design system definito nella Fase 0.

**Deroghe ad AGENTS.md previste: nessuna.**
Al termine del lavoro verrà fornito un report finale esplicito di conformità ad AGENTS.md (es. `Violazioni MUST: 0`, `Deroghe SHOULD: 0`).

## 2. Ordine di implementazione

| Fase | Intervento | Motivo dell'ordine |
| --- | --- | --- |
| 0 | Audit completo UI e contratto visivo | Stabilisce le regole semantiche e i componenti base da usare. |
| 1 | Toggle `+ / − Crea esercizio` e `+ / − Crea scheda` | Modifica locale e isolata, che usa già i nuovi componenti. |
| 2 | Allenamento libero + salvataggio come scheda | Modifica al flusso workout, isolata rispetto all'account. |
| 3 | Nuovo percorso guest → Accedi → scelta migrazione | Modifica profonda ai dati e al lifecycle di autenticazione. |
| 4 | Uniformazione sistematica dei controlli esistenti | Corregge il debito visivo del resto dell'app, applicando il design system per ruolo semantico. |
| 5 | Test finali, audit visuale e Preview Vercel | Validazione dell'insieme. |

**Regole di avanzamento:**
* Una fase deve essere chiusa (commit autonomo) e testata prima di iniziare la successiva.
* Le Fasi 1, 2 e 3 devono utilizzare le primitive della Fase 0 fin dalla loro creazione.

## 3. Dettaglio Fasi

### Fase 0 — Audit approfondito di ogni singolo tasto e contratto visivo
* **Esaustività**: Censimento di bottoni, toggle, menu, `role="button"`, tab, accordion, `ContextMenu`, timer, bottom navigation, controlli icon-only e `div/span` con `onClick`.
* **Report persistente**: Verrà creato e mantenuto il documento `docs/audits/ui-controls-2026-09-12.md` con una riga per ogni controllo verificato, annotando: tipo semantico, dimensioni/touch target, font, peso, colore, icona, hover, active, focus-visible, disabled, loading, `aria-*`, comportamento mobile e wrapping.
* **Varianti semantiche**: Coerenza *per ruolo semantico* (es. timer non deve somigliare a una CTA primaria).
* **Iconografia**: Sostituzione con `lucide-react` **solo** per emoji usate come icone funzionali. Emoji decorative, contenuti editoriali e loghi brand (es. Google) restano invariati.

### Fase 1 — `+ / − Crea esercizio` e `+ / − Crea scheda`
**TrainingExercises.tsx / TrainingRoutines.tsx**:
* Form chiuso: mostrare `+ Crea esercizio` (o scheda).
* Click: apre form, pulsante diventa `- Crea esercizio`. Accessibilità: aggiungere `aria-expanded`, `aria-controls` e icone `Plus`/`Minus` Lucide con `aria-hidden`.
* Il click su `- Crea esercizio` (o scheda) **deve usare la medesima routine di reset di `Annulla`**, cancellando nome, selezioni e stato temporaneo, non solo chiudendo la UI.
* Modifica esercizio/scheda esistente: toggle non visibile.

### Fase 2 — Allenamento libero e salvataggio
* **Avvio**: Pulsante `Allenamento libero` in `TrainingSessionSetup.tsx`, avvia sessione via `startFreeWorkout()` senza `routineId`.
* **Identificazione**: Nel report di fine workout, la sessione libera è riconosciuta unicamente tramite `fromEndWorkout && !workout.routineId` senza aggiungere nuovi campi al database.
* **Salva come scheda**: Il comando compare solo nel report appena concluso, e solo se c'è almeno un esercizio. Protetto da doppio-click/loading.
* **Dati trasferiti**: Copia ESCLUSIVAMENTE di: ordine esercizi, `exId`, numero di serie e tecniche compatibili. Deriva min/max reps dalle serie compilate. **NON copia**: pesi, kg, durata, cardio, rating, dolori o note (a meno che non supportati da `WorkoutRoutine`).
* **Sincronizzazione**: Utilizza `saveUserData`. In offline, rispetta il contratto del progetto distinguendo il salvataggio locale dalla sincronizzazione remota (nessun falso feedback "salvato sul cloud").

### Fase 3 — Banner modalità senza account e Flusso Migrazione
* **Banner**: In `App.tsx` (o dedicato), solo testo informativo e tasto **Accedi** (variante canonica Fase 0).
* **LoginBox**: Il pulsante `Accedi` apre il `LoginBox` come overlay/full-screen (senza modali complessi né duplicare in `AccountCard`). Aggiungere tasto "Torna alla modalità locale".
* **Scelta Migrazione ("Trasferisci" vs "Non trasferire")**: Intercettata prima di completare il login.
* **Semantica "Non trasferire"**: Significa "non importare i dati guest nell'account". I dati guest originari **non** vengono eliminati, ma restano recuperabili in modalità locale.
* **Ciclo di vita Policy**: Copre *tutti* i provider (Google popup/redirect, email login/signup). Impostata prima dell'auth in `localStorage`, sopravvive ai redirect, consumata da `AuthContext` una volta sola e poi rimossa (o rimossa se l'utente annulla il flusso).
* **Gestione sessione attiva (Cruciale)**: Prima del cambio identità, `localWorkout` e bozze attive del guest vengono flushate/snapshotate. Se si trasferisce, il workout attivo viene preservato nell'account; se "Non si trasferisce", il workout attivo resta associato all'archivio guest e rimosso dalla view dell'account.

### Fase 4 — Uniformazione completa del sito
Applicazione iterativa delle varianti semantiche definite in Fase 0 al resto dell'app, correggendo il debito tecnico senza uniformare meccanicamente elementi con funzioni diverse.

## 4. Strategia test per lotto e Gate finale
In aggiunta alla matrice di test già esistente per concorrenza e offline, si integreranno i seguenti scenari specifici:
* Migrazione guest con un **workout attivo in corso**.
* Recuperabilità del guest: flusso "Non trasferire" -> login account -> logout -> "Continua senza account" -> verifica presenza vecchi dati guest.
* Google redirect con preservation della policy di migrazione.
* Allenamento libero avviato a 0 schede esistenti.
* Salvataggio della scheda a fine allenamento libero in modalità offline.
* Verifica `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e` prima di ogni completamento fase.