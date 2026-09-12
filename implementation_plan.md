# Piano di correzione dell'audit LogBook

Data: 10 settembre 2026. Baseline: `5a04e97a367dc2245f239addacb2f475b1231452`.
Stato: **approvato dall'utente il 10 settembre 2026; implementazione in corso**.

## Obiettivo e criterio di completamento

Gestire tutti i finding LB-01–LB-26 di `audit_logbook_2026.md`, oltre ai difetti di tooling/documentazione e alle verifiche aperte elencate nell'audit. Ogni finding avrà un esito con modifica, test e prova, oppure una motivazione verificabile se l'ipotesi risulta smentita. Nessun finding sarà chiuso sulla sola base della compilazione.

L'audit resta il documento storico della baseline. Il consuntivo delle correzioni sarà separato. La richiesta copre implementazione e verifiche locali/isolate; pubblicazione e modifiche alle dashboard saranno presentate come operazioni concrete dopo la validazione. Non verranno usati account reali o dati di produzione per test distruttivi.

Il repository è ancora alla baseline, con il solo audit non tracciato. Prima dell'implementazione creare un branch `codex/audit-remediation`, preservando audit e piano. Nessun reset di modifiche dell'utente.

## Decisioni di progetto proposte

### 1. Persistenza e identità

- Distinguere modifica in memoria, commit locale e conferma remota; il feedback ottimistico non equivale a un salvataggio durabile.
- Serializzare le operazioni locali per utente. Cache e operazioni pendenti vengono scritte atomicamente in IndexedDB, con versione del formato, owner, revisione locale e baseline necessaria alla riconciliazione.
- Separare guest e utenti autenticati. Una vecchia cache senza owner non viene attribuita automaticamente all'account corrente: conservarla come recuperabile e richiedere una scelta esplicita solo quando il proprietario non è determinabile.
- Incrementare un'epoch a ogni cambio autenticazione/reset e verificarla ai confini asincroni; callback vecchi non modificano store, baseline o stato di sincronizzazione nuovi.
- Conservare il contratto pubblico DB a risultati espliciti. Le azioni store rigettano su persistenza fallita/rifiutata; `local-pending` significa copia locale verificata, non successo cloud.

### 2. Un solo percorso di replica

- Introdurre una coda applicativa durevole per UID e usare Firebase SDK come unico canale di scrittura dei dati utente. Eliminare il replay REST indipendente dal service worker.
- Una sola operazione attiva per owner, completamenti condizionati a operation ID/revisione. Timeout non cancella una Promise sottostante: conservare il suo esito e rendere idempotente il retry.
- Per modifiche concorrenti, leggere il documento remoto in transazione e applicare soltanto i cambiamenti intenzionali rispetto alla baseline. Un valore remoto uguale al risultato atteso è già applicato; un valore diverso sia dalla base sia dal risultato è un conflitto da conservare.
- Le transazioni richiedono rete: offline si conferma la copia locale e si mantiene la coda; replay su connessione/foreground/riapertura. **A pagina chiusa non si promette la replica remota automatica del SW.** L'app resta utilizzabile offline.
- Migrare le vecchie code senza eliminarle alla semplice lettura. Non riprodurre token/payload di proprietario ambiguo. Gestire le pending writes SDK già esistenti prima del passaggio al nuovo writer.
- Conservare inizialmente i path e formati cloud esistenti. Se emergesse la necessità di nuovi metadati cloud, aggiornare tutti i file canonici e documentare il formato prima di implementarli.

### 3. Dati parziali, merge e conflitti

- Registrare quali mesi sono completi. Un mese mai letto non equivale a un mese vuoto e non può essere sostituito o eliminato per assenza nello snapshot locale.
- Esprimere upsert e cancellazioni per ID/data nella coda, conservando base e valore desiderato. La transazione fonde cambiamenti indipendenti; per record modificati da entrambe le parti preserva entrambe le alternative invece di scegliere silenziosamente.
- Hydration sostituisce i record non sporchi nei mesi completi; riapplica le operazioni locali pendenti senza resuscitare cancellazioni remote. Conserva i mesi non caricati.
- Il merge guest mantiene la policy guest definita da AGENTS, ma usa una migrazione durabile e non un reload parziale che scarta il risultato.
- Aggiungere caricamento progressivo dello storico e acquisizione completa paginata per il backup. Mostrare chiaramente quando il dataset disponibile è parziale.
- Non dedurre da vecchi client una garanzia di concorrenza che non possiedono: prima del rilascio verificare la coesistenza con la versione precedente e il passaggio PWA. Un client vecchio può continuare a scrivere snapshot completi; questo è un vincolo di rollout, da non nascondere.

### 4. Backup, migrazioni e cancellazione

- Un formato JSON versionato con owner, completezza, UserData e stato locale recuperabile. Importare anche backup ordinari/d'emergenza precedenti.
- Distinguere ripristino ed importazione incrementale; anteprima delle collisioni, nessuna mutazione in place, ricalcolo dei derivati e commit locale prima della conferma.
- I consensi importati possono essere conservati come dati storici ma non aggirano l'accettazione richiesta per identità/versione correnti.
- Migrazioni non distruttive: preservare il dato originale fino a successo verificato; scarti/quarantena devono essere recuperabili. Non tentare di ricostruire dati già persi inventandoli.
- Cancellazione account: reautenticazione prima di eliminare, arresto dei writer, query/batch paginati con esito esplicito, verifica dei residui, rimozione Auth solo dopo bonifica confermata. In caso di parzialità conservare identità e capacità di ripresa, con messaggio chiaro. Nessuna falsa promessa di atomicità tra Firebase Auth e Firestore.

## Lotti di implementazione

Ogni lotto comprende test mirati durante lo sviluppo e la sequenza lint → test → build → E2E prima di dichiararlo pronto. Non servono nuove approvazioni per ciascun lotto già compreso nel piano approvato; eventuali cambi sostanziali al protocollo o azioni di produzione verranno resi reviewabili prima di procedere.

| Lotto | Finding | Implementazione e file principali | Accettazione |
|---|---|---|---|
| A — Prove affidabili | LB-21/22 | `package.json`, lockfile, `vitest.config.ts`, nuovo config stress, `vite.config.ts`, `playwright.config.ts`, `tests/setup.tsx`, test Rules, `firebase.json`, workflow CI. Separare test con DB reale/emulato dai mock UI; stress con include reali; correggere teardown preview e gate coverage effettivo | Tutti i file stress selezionati; 60 fallimenti triagiati per contratto senza disattivare le invarianti; Rules emulator con anonimo/A/B e payload malformati; errore/soglia non soddisfatta causa exit non zero |
| B — Recovery e validazione | LB-08/09 | `src/lib/export.ts`, `schema.ts`, `schemas/*`, `types.ts`, `useSettings.ts`, `SettingsView.tsx`, test export/schema; moduli dedicati per formato/migrazioni se utili | Round-trip completo e legacy; 501 elementi conservati; numeri finiti; sonno numerico migrato; ID coerenti; import fallito lascia invariato il dato precedente |
| C — Commit locale e sessioni | LB-01/02/06/13 | Nuovi moduli storage/sync, `createDataSlice.ts`, `createSyncSlice.ts`, `useAppStore.ts`, `main.tsx`, `AuthContext.tsx`, `db_core.ts`, `GlobalDialog.tsx` | Nessun synced dopo errore IndexedDB; dirty immediato; logout attende la revisione corrente; vecchi completamenti non attraversano owner/epoch; conflitto recuperabile dopo rejection |
| D — Replica e storico | LB-03/04/05/07 | `db.ts`, `db_training.ts`, `db_nutrition.ts`, `merge.ts`, `AuthContext.tsx`, `sw.ts`, moduli coda/transazioni, consumer storico/grafici e backup | Mese remoto con 31 giorni sopravvive all'import di uno; A/B convergono su modifiche indipendenti; conflitti espliciti sulle collisioni; cancellazioni non risorgono; guest di 12 mesi preservato; timeout/retry idempotenti |
| E — Workout, alimenti, date e bozze | LB-11/12/14/15/16/20 | `useWorkoutSession.ts`, `createWorkoutSlice.ts`, `useNutritionMeals.ts`, `NutritionFoodArchive.tsx`, `useNutritionPlanning.ts`, `calc/planning.ts`, `useNutritionMeasurements.ts`, `useLocalStorage.ts`, `WorkoutTimer.tsx`, navigatori Nutrition/Data, utility date/draft | Creazioni con ID stabile, porzioni distinte; fine workout una sola volta anche dopo retry; rimozione locale sincrona; date corrette nei fusi/DST; zero ON conservato; fine ciclo coerente; bozze per owner/data e input non sovrascritti |
| F — Catalogo | LB-19 | `catalogService.ts`, `deltaResolver.ts`, handler restore, integrazione bootstrap/store e `scripts/seed-catalog.mjs` | Cache vuota non considerata catalogo completo; aggiornamento atomico nello store; restore persiste; omonimi con ID distinti conservati; seeding vuoto bloccato, senza eseguirlo su produzione |
| G — Account e telemetria | LB-10/17/18 | `db_account.ts`, `useSettings.ts`, `firebase.ts`, `telemetryHub.ts`, `telemetrySanitizer.ts`, `PrivacyPolicy.tsx`, guide telemetria e lifecycle | Cancellazione parziale segnalata/riprendibile; Auth non eliminato con residui; revoca SDK immediata e resistente alle race; niente nomi liberi nei dettagli; purge/coda per UID; versione telemetria corretta |
| H — Accessibilità e aggiornamenti | LB-23/24 | `GlobalDialog.tsx`, `useDialogStore.ts`, `ReloadPrompt.tsx`, `BufferedInput.tsx`, `App.tsx`, `main.tsx`, CSS e test browser | Focus iniziale/trap/ritorno, Escape coerente, background inert; update differibile; flush e commit locale prima di reload; niente loop preload; zoom assistivo preservato |
| I — Performance e manutenzione | LB-25/26 e debito §7 | `calc/analytics.ts`, `useAnalyticsWorker.ts`, liste Data/archivio, storage/diff, package/lockfile, script check/icone, documentazione | Benchmark ripetibili 1/5/10 anni; filtro temporale anticipato, lookup per ID, meno copie/riscritture; virtualizzazione solo dove utile; warning lint risolti motivatamente; catena vulnerabile aggiornata con versioni supportate |

I nuovi moduli e test avranno responsabilità ristrette; i nomi definitivi saranno scelti dopo aver verificato le utility esistenti. Le aree che attraversano più lotti vengono chiuse solo quando passa il test dell'intero flusso.

## Dipendenze e sicurezza

- Aggiungere solo dipendenze di sviluppo necessarie agli emulatori/test, con versione verificata e lockfile aggiornato. Verificare Java e strumenti Firebase prima di scegliere il runner.
- Rivalutare l'advisory UUID corrente e una versione compatibile della catena amministrativa. Evitare downgrade major automatici, override non verificati e aggiornamenti generalizzati estranei alla correzione.
- La migrazione a Vitest 5 è opzionale: eseguirla solo se utile a risolvere un impedimento dimostrato; una versione nuova non è di per sé una correzione dell'audit.
- Per LB-22 avviare prima test comportamentali sulle Rules attuali. Se la validazione richiede modifiche a `firestore.rules`, preparare patch retrocompatibile e test prima del deploy richiesto da AGENTS. Il target e l'azione di deploy saranno presentati esplicitamente; nessun deploy implicito insieme a un test.
- Ispezionare le protezioni GitHub/Vercel in sola lettura quando accessibili. Gli eventuali required checks e Deployment Checks da applicare saranno indicati con i nomi effettivi dei job dopo la verifica della CI.

## Matrice di test obbligatoria

1. **Storage reale:** IndexedDB nel browser, quota/errori simulati al confine, riapertura dopo commit locale e prima del commit remoto. Il mock che restituisce synced non vale come prova.
2. **Concorrenza:** due contesti browser sullo stesso account, due account differenti, completamenti invertiti, logout multi-tab, import durante fetch, migrazione guest durante modifica.
3. **Rete:** offline prima di avvio, durante save, timeout seguito da commit tardivo, reconnect, SW assente, token/App Check rifiutati in ambiente di prova.
4. **Recovery:** backup completo 24 mesi, JSON d'emergenza, schema legacy, array oltre soglia, ID duplicati e dati corrotti; nessun dato silenziosamente azzerato.
5. **Dominio:** double submission, porzioni omonime, eliminazione/retry, 0/7 ON, durata ciclo non multipla di sette, mezzanotte, fusi a ovest di UTC e DST.
6. **Sicurezza:** Rules emulator, isolamento delle code, fallimento cancellazione per ogni query/batch; payload telemetria e revoca analytics verificati.
7. **UI/PWA:** tastiera/focus, viewport 320 px, upgrade fra due build, input focused e workout attivo, cold start offline con asset già installati. iOS/VoiceOver reale resta una verifica assistita se non è disponibile un dispositivo controllabile.
8. **Performance:** fixture deterministiche, warm-up e più misure; confronto prima/dopo per parsing, persistenza e grafici. Nessun budget dichiarato raggiunto sulla base del solo desktop se riguarda iOS.

Comandi finali: `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`, `npm run test:stress`, suite emulator/coverage aggiunte, audit prod e dev, `npm run analyze` dopo nuove dipendenze. Registrare durate, quantità di test e impedimenti; non cancellare o indebolire test per nascondere un fallimento.

## Rischi e rollback

| Rischio | Contromisura e rollback |
|---|---|
| Attribuzione errata della cache legacy | Non assegnare owner senza evidenza; conservare originale, consentire export/import esplicito; migrazione copy-on-write |
| Retry o cambio versione che duplica scritture | ID/revisione e confronto base/remoto/desiderato; test transazione e completamento tardivo; non riattivare contemporaneamente writer REST e SDK |
| Client precedenti ancora attivi | Prova di compatibilità e sequenza di aggiornamento prima del rollout; limite documentato se non imponibile lato server |
| Migrazione schema distruttiva | Snapshot originale e quarantena; lettori compatibili; nessuna cancellazione automatica degli archivi di recovery |
| Rules più restrittive rifiutano dati legacy | Fixture legacy/emulator prima del deploy; copia delle Rules precedenti e rollback del solo cambiamento se necessario |
| Cancellazione interrotta | Conservare account e stato di avanzamento; ripresa idempotente; non esiste rollback magico di dati remoti già cancellati |
| Refactoring performance modifica risultati | Confronto degli output su fixture prima/dopo; separare ottimizzazioni dai cambi di formula; revert del modulo senza migrare dati |
| Aggiornamento dipendenze rompe tooling | Lockfile precedente e aggiornamenti circoscritti; test admin isolati e verifica bundle |

Rollback del codice non significa rollback dei dati: dopo una migrazione locale non riportare l'app a un writer che ignora il nuovo formato e ne distrugge la coda. Conservare compatibilità di lettura o procedura di export/recovery prima di ritirare una versione.

## Informazioni eventualmente necessarie più avanti

La correzione locale può partire senza altre informazioni. Per completare le verifiche esterne potranno servire accesso a un progetto Firebase di prova, conferma del target di deploy Rules, accesso alle dashboard e una prova guidata su iOS. Saranno richiesti quando la relativa verifica sarà pronta, continuando nel frattempo gli altri lotti. Nessuna password o chiave privata va incollata nella conversazione.

## Consegna

- Codice e test verificati sul branch dedicato.
- Registro LB-01–LB-26 con evidenza di chiusura, eventuali ipotesi smentite e limiti residui espliciti.
- Documentazione aggiornata ai contratti effettivi e procedura di migrazione/rollback.
- Riepilogo test, bundle, audit dipendenze e controlli esterni ancora necessari prima del rilascio.
- Nessun finding dichiarato risolto solo perché il suo codice è stato cambiato.
