# Audit tecnico di LogBook — 2026

**Repository:** `gernotfound/logbook` · **Baseline:** `5a04e97a367dc2245f239addacb2f475b1231452` · **Raccolta evidenze:** 9–10 settembre 2026, Europe/Rome.

Working tree pulito all'avvio e nuovamente verificato alla ripresa del 10 settembre. Remote: `https://github.com/gernotfound/logbook.git`. Ambiente locale: Windows, PowerShell, Node **26.4.0**, npm **11.17.0**, applicazione **1.0.2**. I riferimenti di riga riguardano questa baseline. Il solo documento finale aggiunto è questo report; nessuna correzione applicativa, installazione, migrazione, scrittura deliberata su backend di produzione, seeding o deploy è stata eseguita.

## 1. Executive summary

**La build funziona, ma le evidenze non sostengono una garanzia di conservazione dei dati nei passaggi critici di sincronizzazione, logout e ripristino.** Non propongo una riscrittura generale: le funzioni di dominio e la separazione in slice sono una base utilizzabile. Occorre però rendere espliciti identità dell'utente, stato di persistenza, completezza dei dati caricati e ordine delle operazioni.

Sono particolarmente urgenti: la conferma del salvataggio quando IndexedDB fallisce; il logout durante il debounce; il risultato ignorato nel collegamento guest; le sostituzioni di mesi caricati solo parzialmente; il backup che non ripristina tutti i dati; la cancellazione account che può nascondere residui cloud. Il parsing permissivo evita alcuni crash ma può trasformare dati validi oltre soglia in array vuoti. Queste sono cause concrete di perdita o falsa conferma, non semplici preferenze stilistiche.

Non è stata dimostrata una vulnerabilità **Critical**, né un accesso remoto ai dati di un altro account aggirando le Rules. I rischi di isolamento rilevati riguardano soprattutto lo stato del client e i completamenti asincroni. Le Rules effettivamente distribuite, App Check enforcement e le protezioni Vercel non sono stati verificati nelle rispettive console.

### Risultati principali dei controlli

| Controllo | Esito osservato |
|---|---|
| Lint | Exit 0, **51 warning**, non un esito privo di segnalazioni |
| Suite ordinaria | **1178/1180** test passati; 2 fallimenti nella prima esecuzione |
| Rilancio dei due file falliti, 2 worker | **50/50** passati; suggerisce sensibilità a tempi/concorrenza, non prova due difetti applicativi |
| Build | Passata; warning su import dinamico inefficace e opzione deprecata |
| E2E locale | Primo processo interrotto; rilancio: **1 scenario passato**, errore di teardown del server dopo 60 s; comando non classificato come riuscito |
| `test:stress` | Nessun file selezionato, exit 1 |
| Stress con elenco esplicito dei file | **811/871** passati, 60 falliti in 19 file; contratti obsoleti e bug da distinguere |
| Riproduzioni temporanee | **22 osservazioni** su dati sintetici; risultati e metodo in appendice |
| `npm audit` | 6 segnalazioni moderate nella catena dev; 0 High/Critical |
| `npm audit --omit=dev` | 0 segnalazioni |
| GitHub sul commit | Workflow Unit/Integration ed E2E riusciti; risultati diversi dall'esecuzione locale |

### Come leggere i finding

Gli ID `LB-01`…`LB-26` restano stabili anche se cambierà la priorità. **Certo** indica comportamento letto senza ambiguità o riprodotto; **molto probabile** indica percorso completo ricostruito ma non eseguito in un browser/backend reale; **possibile** indica un rischio condizionato ancora da riprodurre. Una riproduzione con Firebase/storage simulati dimostra il comportamento del codice entro quei confini, non il comportamento di rete del servizio reale. La severità misura le conseguenze dello scenario, non la sua frequenza stimata.

## 2. Critical/High findings

### LB-01 — Salvataggio locale fallito esposto come riuscito

**Categoria:** integrità/persistenza · **Severità:** High · **Confidenza:** certo, R09.

**Riferimenti:** `src/store/slices/createDataSlice.ts:36–53`; `src/store/slices/createSyncSlice.ts:55–98`; `src/lib/db.ts:146–148`.

`saveUserDataToCache` avvia `idbSet` senza restituire una Promise verificabile e cattura il fallimento. Il salvataggio guest passa poi da `DB.saveUserData`, che senza utente risponde `{ok:true,status:'synced'}`. Nella riproduzione, IndexedDB rifiuta la scrittura, la cache non contiene il dato e il chiamante riceve comunque successo. Anche per un utente autenticato manca una conferma distinta della durabilità locale.

**Scenario/conseguenza:** un guest salva in condizioni di quota esaurita o storage indisponibile, vede il dato in memoria, chiude la pagina e lo perde. La UI può confermare un'operazione che non ha raggiunto alcuno storage persistente.

**Correzione proposta:** attendere e propagare l'esito della persistenza locale; distinguere durabilità locale e replica remota. La modalità guest deve confermare solo dopo il commit IndexedDB, con errore visibile e possibilità di esportazione se fallisce.

**Regressione:** `idbSet` rifiutato e ritardato, quota/storage indisponibile, chiusura immediata; verificare Promise, messaggio, cache e riapertura, non solo stato Zustand.

### LB-02 — Il logout può eliminare modifiche ancora nel debounce o un workout locale

**Categoria:** integrità/lifecycle · **Severità:** High · **Confidenza:** certo per lo stato del debounce, molto probabile per il flusso logout completo.

**Riferimenti:** `src/store/slices/createSyncSlice.ts:47–95,190–213`; `src/contexts/AuthContext.tsx:377–447`; `src/store/slices/createWorkoutSlice.ts:67–81`.

L'inizio di un salvataggio porta `syncing` a true ma lascia `syncHealth` su `synced`. Il logout usa soprattutto `syncHealth === 'synced'` e l'assenza di conflitti per dichiararsi sicuro, quindi cancella il timer e purga i dati. R08 mostra `syncing:true` insieme a `syncHealth:'synced'` prima che parta il salvataggio remoto. Inoltre `setLocalWorkout` aggiorna lo snapshot in memoria e localStorage, ma non avvia autonomamente il salvataggio cloud.

**Scenario/conseguenza:** modifica seguita da logout entro 1 secondo; oppure sessione avviata e logout senza altra operazione che salvi `UserData`. La copia locale viene cancellata prima che esista una replica confermata. L'attesa delle pending writes Firestore non comprende un'operazione ancora nel debounce applicativo.

**Correzione proposta:** stato dirty immediato; barriera che includa debounce, persistenza locale, operazioni in volo e workout; bloccare l'uscita sicura fino alla conferma della revisione corrente o a una scelta esplicita di esportazione/perdita.

**Regressione:** logout a 0/999/1001 ms, durante commit, con workout appena avviato, offline e dopo un rifiuto; nessuna uscita indicata come sicura con dati non protetti.

### LB-03 — Collegamento guest: risultato ignorato e ricaricamento distruttivo

**Categoria:** integrità/autenticazione · **Severità:** High · **Confidenza:** certo per il controllo mancante; flusso Auth completo non riprodotto contro Firebase.

**Riferimenti:** `src/contexts/AuthContext.tsx:138–176`; `src/lib/db.ts:114–140,268–303`; `src/lib/merge.ts:352–369`.

Il ramo guest rimuove subito il flag locale, cattura i dati, calcola il merge e chiama direttamente `DB.saveUserData`. Non controlla `{ok,status}`. Un risultato `rejected` o `failed` non entra nel `catch`: il codice ricarica il cloud e sostituisce lo store. Il ricaricamento contiene soltanto tre mesi e non contiene `pendingConflicts`, campo locale.

**Scenario/conseguenza:** il cloud rifiuta il merge e la successiva lettura riesce: le modifiche guest spariscono dalla copia operativa/cache. Anche dopo un salvataggio riuscito si perdono localmente lo storico guest fuori finestra e la scelta nutrizionale in conflitto; lo storico remoto può essere ancora presente. Le modifiche eseguite durante il link possono essere superate dallo snapshot catturato prima dell'attesa.

**Correzione proposta:** migrazione con snapshot locale durabile, controllo esplicito del risultato, identità/revisione e mantenimento dei dati fuori finestra e dei conflitti. Non sostituire il risultato completo con una lettura parziale. Rendere recuperabile la migrazione interrotta.

**Regressione:** tre risultati negativi distinti, timeout seguito da successo, guest con 12 mesi, piani in conflitto, modifica durante popup e cambio account durante ciascun await.

### LB-04 — Mesi parziali sostituiti integralmente e aggiornamenti concorrenti persi

**Categoria:** architettura/integrità · **Severità:** High · **Confidenza:** certo per il payload, R18; concorrenza remota non riprodotta.

**Riferimenti:** `src/lib/db.ts:114–122,201–248`; `src/lib/db/db_nutrition.ts:27–61`; `src/lib/db/db_training.ts:28–64`.

Le letture ordinarie coprono mese corrente e due precedenti. Le scritture mensili usano `batch.set` dell'intero documento senza merge, versione o prova di completezza. R18 cattura una scrittura di maggio contenente soltanto il giorno importato, senza opzioni di merge. Il root viene a sua volta riscritto con tutti i campi mappati quando uno cambia: `{merge:true}` non risolve la concorrenza sugli array/campi inviati.

**Scenario/conseguenza:** su un dispositivo nuovo si importa una giornata di un mese remoto non caricato: gli altri giorni di quel mese possono essere cancellati dalla sostituzione. Due dispositivi modificano giorni diversi nello stesso mese o array root diversi da snapshot vecchi: l'ultima scrittura può perdere il contributo dell'altro. Firestore documenta la risoluzione last-write-wins per modifiche multiple allo stesso documento; non applica il merge semantico dell'app. [Firebase: dati offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline).

**Correzione proposta:** indicare esplicitamente i mesi completi/caricati; impedire replace di bucket incompleti; adottare operazioni granulari o transazioni con revisione e conflitti. Le cancellazioni devono essere rappresentate, non inferite da un'assenza ambigua.

**Regressione:** maggio remoto con 31 giorni e import di uno; dispositivi A/B su giorni e campi differenti; eliminazione concorrente; riordino dei commit; mesi al limite di dimensione.

### LB-05 — Hydration: cancellazioni remote riappaiono e campi root locali vengono sovrascritti

**Categoria:** integrità/merge · **Severità:** High · **Confidenza:** certo, R04.

**Riferimenti:** `src/lib/merge.ts:389–433`; `src/contexts/AuthContext.tsx:80–95,197–213`.

`mergeCloudIntoLocal` unisce lo storico con priorità locale; un elemento assente dal cloud resta nel client. Per i campi root prevale invece lo spread cloud. Non esistono marker dirty per campo né tombstone. R04 conserva una sessione eliminata nel cloud e cambia altezza locale 180 in cloud 170. Il timeout di 1500 ms nel ritorno in foreground **risolve**, quindi non impedisce la successiva lettura se ci sono ancora scritture pendenti.

**Scenario/conseguenza:** una cancellazione fatta su A non si propaga a B, che può risalvarla; un profilo/routine modificato offline o rifiutato viene rimpiazzato dalla versione cloud al ritorno in primo piano. La preservazione dello storico fuori finestra è utile, ma non distingue questi casi.

**Correzione proposta:** separare merge di migrazione guest da riconciliazione ordinaria; usare revisione base, campi/record dirty e tombstone. Adottare il cloud solo per ciò che è noto come non modificato localmente.

**Regressione:** cancellazione A→B→A senza resurrezione; modifica locale root non confermata; timeout di pending writes; conservazione dei mesi non letti senza mascherare eliminazioni nei mesi completi.

### LB-06 — Identità e completamenti asincroni non sono isolati lungo tutto il flusso

**Categoria:** isolamento/sicurezza del client · **Severità:** High · **Confidenza:** certo per aggiornamenti obsoleti, possibile per contaminazione completa fra account.

**Riferimenti:** `src/store/slices/createSyncSlice.ts:83–147,202–213`; `src/lib/db/db_core.ts:16–22`; `src/main.tsx` (bootstrap cache); `src/contexts/AuthContext.tsx:73–77,138–188`; `src/lib/db/db_account.ts:7–39`.

La cache `logbook_cached_user_data` e la baseline `lastSavedStateStr` non sono identificate per UID. Reset/cancellazione fermano il debounce ma non invalidano tutti i salvataggi già avviati. R10 risolve un vecchio save dopo `resetStore`: lo stato vuoto riceve `syncHealth:'rejected'` e l'errore della sessione precedente. Esiste un controllo UID nel successo di `loadData`, ma non nel ramo guest né in tutti i catch/finally; il layer DB può già aver aggiornato la baseline prima di quel controllo.

**Scenario/conseguenza:** cambio account durante un'operazione lenta, logout da un'altra scheda o purge fallita. Stato/errori/baseline vecchi possono agire sul nuovo contesto; una cache residua senza proprietario può essere riutilizzata e unita al nuovo utente. Non è dimostrato un bypass delle Rules: l'eventuale copia viene inviata dal client usando l'identità corrente.

**Correzione proposta:** envelope `{uid,schemaVersion,revision,data}` per cache e coda; epoch di autenticazione verificata prima e dopo ogni await; baseline per UID; scarto dei completamenti obsoleti; riscontro degli errori di purge. Definire anche il trattamento della cache persistente SDK.

**Regressione:** A→B con letture/scritture ritardate e risolte fuori ordine, logout multi-tab, purge IndexedDB rifiutata, riavvio con cache di A. Nessun dato/errore/revisione di A deve diventare stato operativo di B.

### LB-07 — Due code di replica senza ordine comune: SDK e service worker REST

**Categoria:** rischio architetturale/PWA · **Severità:** High · **Confidenza:** certo per il timeout non cancellante, R19; possibile per gli interleaving di rete.

**Riferimenti:** `src/lib/db/db_core.ts:8–13`; `src/lib/db.ts:28–42,259–291`; `src/sw.ts:29–119`.

Dopo timeout il commit SDK resta in vita e viene creata anche una copia REST in IndexedDB. R19 dimostra che `withTimeout` termina con `SyncTimeoutError`, poi l'operazione sottostante può completare. Payload e token SW sono due chiavi globali separate; il successo elimina entrambe senza verificare che siano ancora quelle inviate. Un nuovo salvataggio SDK riuscito non elimina necessariamente il precedente payload REST. Una lettura elimina invece preventivamente la coda REST assumendo che l'SDK la sostituisca.

**Scenario/conseguenza:** una vecchia replica REST arriva dopo una nuova SDK, oppure il completamento della coda vecchia cancella quella nuova. Il risultato può essere una regressione di dati o la perdita del retry. `navigator.serviceWorker.ready` non ha un timeout nel ramo di salvataggio: in assenza di registrazione utile la Promise può restare pendente. La richiesta REST porta Bearer Auth ma non un token App Check; il suo funzionamento con enforcement richiede verifica isolata. Nessun replay è stato inviato in produzione.

**Correzione proposta:** un solo protocollo di replica; se il SW resta necessario, outbox atomica per UID con operation ID/revisione, completamento condizionale, deduplicazione e strategia Auth/App Check. Non interpretare un timeout come cancellazione o conferma locale automatica.

**Regressione:** timeout→commit tardivo→nuovo save→replay vecchio; nuova coda durante fetch; token scaduto; SW assente; riapertura e cambio UID durante sync; backend emulato con ordine controllato.

### LB-08 — Backup incompleto e ripristino non equivalente all'esportazione

**Categoria:** integrità/portabilità · **Severità:** High · **Confidenza:** certo, R13–R15.

**Riferimenti:** `src/lib/export.ts:8–40,288–405`; `src/hooks/useSettings.ts` (azioni export/import).

Il backup ordinario omette `customFoods`, `activeWorkout`, `catalogOverrides`, `activeCycleId`, `activePains`, `legalConsent`, `nutritionPlanningOrigin` e `pendingConflicts`. Il contenuto di history/nutrition è limitato ai dati disponibili nello store. Il ripristino applica profilo e piano solo se quelli correnti sono falsy: i default `{}` e il piano generato impediscono il ripristino anche in un'installazione apparentemente vuota. R14 mantiene profilo vuoto e peso del piano 80 invece dei valori esportati. Il backup d'emergenza usa `format` e `userData` annidato; l'import accetta `type:'backup'|'share'`: R15 lo rifiuta.

Il merge nutrizione modifica inoltre gli oggetti giornalieri correnti in place e aggiunge pasti senza ricalcolare i totali; se l'import fallisce dopo quella mutazione, non è garantita l'immutabilità dello stato precedente. `downloadFile` non viene atteso da alcune funzioni di export.

**Scenario/conseguenza:** si esporta prima di un logout forzato o della sostituzione del dispositivo e si scopre soltanto dopo che il backup non consente il recupero dichiarato. I CSV sono utili per consultazione, ma non sostituiscono un archivio di ripristino.

**Correzione proposta:** formato unico versionato e completo, distinguendo export parziale e completo; fetch paginato dell'intero storico per il secondo; import in copia isolata con migrazioni, ricalcolo e anteprima delle collisioni. Non ripristinare automaticamente consensi legali senza una policy esplicita.

**Regressione:** round-trip di ogni campo, stato iniziale con default, archivio di 24 mesi, file d'emergenza, dati corrotti, errore FileReader e fallimento del save; confronto semantico e assenza di mutazioni in caso di errore.

### LB-09 — Fallback Zod distruttivi e gateway non uniforme

**Categoria:** integrità/validazione · **Severità:** High · **Confidenza:** certo, R01/R02/R06/R07.

**Riferimenti:** `src/lib/schema.ts:35–54,80–145`; `src/lib/schemas/schema_utils.ts:91–120`; `src/lib/db.ts:124–140`; `src/lib/schemas/schema_nutrition.ts`.

`z.array(...).max(...).catch([])` azzera l'intero array se supera il limite: R01, **501 esercizi validi → 0**. Analoghi limiti esistono per alimenti, routine, cicli e integratori. Il catalogo risolto viene sottoposto anche a limiti pensati per dati utente. `DB.loadUserData` usa parser parziali e cast invece del gateway root uniforme: `parseCustomFoods` scarta ID numerici che il tipo/schema alimento ammettono (R02). La conversione da stringa di `safeNumber` ammette `Infinity` (R06); il sonno numerico legacy 7.5 scompare (R07). Alcuni schemi preservano oggetti con campi sostituiti da default senza eliminare riferimenti invalidi.

**Scenario/conseguenza:** un import legittimo o un catalogo cresciuto viene salvato come vuoto; dati legacy/corrotti vengono alterati senza un resoconto recuperabile. Validazione riuscita non significa dati invariati o semanticamente coerenti.

**Correzione proposta:** separare recupero da validazione di nuovi input; quarantena/copia del dato originale e resoconto degli scarti; migrazioni esplicite; limiti sui custom, non sull'array risolto; numeri finiti; unico gateway coerente prima dell'adozione nello store.

**Regressione:** soglie N−1/N/N+1, ID numerici/stringa/vuoti, `Infinity`/`1e309`, sonno legacy, relazioni orfane. Nessun azzeramento silenzioso di un array valido per un errore di dimensione.

### LB-10 — Cancellazione account parziale dichiarata riuscita

**Categoria:** lifecycle/privacy tecnica · **Severità:** High · **Confidenza:** certo, R20.

**Riferimenti:** `src/lib/db/db_account.ts:44–114`; `src/hooks/useSettings.ts` (eliminazione e reautenticazione); `src/pages/PrivacyPolicy.tsx` (promessa di cancellazione completa).

Ogni errore di lettura delle cinque subcollection viene sostituito con uno snapshot vuoto. `permission-denied` sui batch di cancellazione viene ignorato e si procede a `deleteUser`, poi si registra successo. R20 simula letture fallite e commit negato: la funzione termina senza errore ed elimina l'identità simulata. Il purge locale avviene prima dell'operazione e anche nel `finally`; la necessità di login recente può emergere dopo che i dati sono già stati cancellati.

**Scenario/conseguenza:** rimangono documenti cloud senza che l'utente ne sia informato, oppure si perdono dati prima di una reautenticazione non completata. I batch da 400 proteggono il limite per batch, ma non rendono atomica l'intera cancellazione.

**Correzione proposta:** reautenticazione preventiva; operazione di cancellazione riprendibile con stato esplicito per raccolta/batch e verifica finale; errore parziale comunicato; preferire un percorso backend controllato per completare la bonifica anche dopo la rimozione dell'identità. Il presente rilievo è tecnico, non una certificazione o valutazione legale di conformità.

**Regressione:** errore di ogni query/batch, login scaduto, timeout e successo tardivo, >400 documenti, interruzione a metà e ripresa. Nessun successo completo finché restano raccolte non verificate.

### LB-11 — Gli alimenti personalizzati nuovi non ricevono un ID

**Categoria:** bug funzionale/integrità · **Severità:** High · **Confidenza:** certo, R03.

**Riferimenti:** `src/lib/calc/nutrition.ts:361–384`; `src/hooks/useNutritionMeals.ts:279–288`; `src/components/Nutrition/NutritionFoodArchive.tsx:64–88`; `src/lib/catalog/deltaResolver.ts:160`.

`validateCustomFood` produce dati puliti senza ID. I due percorsi di creazione li aggiungono direttamente all'array; solo la modifica conserva l'ID precedente. Il resolver filtra poi gli alimenti senza ID. R03 segue validatore→resolver: nuovo alimento valido, `hasId:false`, zero alimenti dopo risoluzione.

**Scenario/conseguenza:** si crea un alimento, il salvataggio sembra riuscito, poi al bootstrap/ricaricamento non compare più. In memoria possono inoltre esistere più elementi con identità indefinita, rendendo ambigue le operazioni successive.

**Correzione proposta:** assegnare un ID stabile nel comando di creazione, prima della persistenza, e validarne l'unicità. Non affidare al resolver la generazione tardiva di identità.

**Regressione:** creazione in entrambi i form, riavvio offline, sync, modifica e duplicazione; l'ID deve rimanere invariato e l'alimento recuperabile.

## 3. Medium/Low findings

### LB-12 — Identità della porzione confusa con identità dell'alimento

**Categoria:** integrità nutrizione · **Severità:** Medium · **Confidenza:** certo, R05.

**Riferimenti:** `src/components/Nutrition/NutritionFoodArchive.tsx:135–153`; `src/lib/merge.ts:52–78,197–198`.

L'aggiunta rapida dall'archivio usa `id:food.id`; due consumazioni dello stesso alimento condividono l'ID. Il merge deduplica per ID e R05 riduce due porzioni a una anche fondendo il giorno con sé stesso. Il flusso in `useNutritionMeals` usa invece ID generati.

**Scenario/conseguenza:** stesso yogurt a colazione e spuntino; hydration/link riducono pasti e calorie. **Correzione:** ID univoco della registrazione e `foodId` separato, con migrazione delle collisioni preservando le porzioni. **Regressione:** stesso alimento due volte, stessi millisecondi, merge ripetuto e cancellazione di una sola porzione.

### LB-13 — Risoluzione conflitto: UID non confrontato e recupero saltato sul rigetto

**Categoria:** integrità/stato · **Severità:** Medium · **Confidenza:** certo, R11.

**Riferimenti:** `src/store/slices/createDataSlice.ts:106–184`.

`expectedUid` viene controllato solo per presenza. La scelta locale rimuove ottimisticamente il conflitto e poi attende `updateUserData`. Se la Promise rigetta, non raggiunge il ramo che dovrebbe ripristinarlo. R11 usa UID diverso, fingerprint corretto e DB rifiutato: il piano locale resta attivo e il conflitto scompare.

**Conseguenza:** perdita del percorso di recupero e falsa chiusura del confronto; in un cambio account manca la barriera dichiarata dal commento. **Correzione:** UID/epoch reali, stato di risoluzione pendente, gestione sia dei risultati negativi sia dei throw; ripristino condizionato alla revisione. **Regressione:** UID errato, fingerprint vecchio, rejected/failed/local-pending e nuovo conflitto durante await.

### LB-14 — Fine workout non idempotente e rimozione locale differita

**Categoria:** integrità/workout · **Severità:** Medium · **Confidenza:** certo per R12 e inserimento; retry completo molto probabile.

**Riferimenti:** `src/hooks/useWorkoutSession.ts:292–366`; `src/store/slices/createWorkoutSlice.ts:23–35`; `src/store/useAppStore.ts:24–35`.

La fine sessione antepone il workout allo storico senza deduplicare l'ID. Dopo un rifiuto, lo storico ottimistico può già contenerlo mentre `localWorkout` resta attivo: riprovare può duplicarlo. La rimozione da localStorage è differita di 300 ms; il flush hidden salva solo oggetti non null. R12 mostra store null e workout ancora presente sul disco durante hidden.

**Conseguenza:** riapertura di una sessione terminata o storico duplicato; `workout_saved` emesso nel `finally` anche in caso di errore altera la telemetria. **Correzione:** comando idempotente per session ID, stato pending e cancellazione locale sincrona protetta; evento con esito reale. **Regressione:** doppio click/conferma, rifiuto→retry, chiusura entro 300 ms e riapertura.

### LB-15 — Navigazione giornaliera errata a ovest di UTC

**Categoria:** date/bug funzionale · **Severità:** Medium · **Confidenza:** certo, R21.

**Riferimenti:** `src/components/Nutrition/NutritionMeals.tsx:36–49`; `src/components/Nutrition/NutritionSupplements.tsx:33–46`.

Le stringhe `YYYY-MM-DD` passano da `new Date(string)` e poi da aritmetica locale. In `America/New_York`, R21 sul 9 settembre restituisce **7 settembre** per precedente e **9 settembre** per successivo. Il formatter locale finale non corregge il parsing UTC iniziale.

**Conseguenza:** visualizzazione e inserimento nel giorno errato durante viaggi o uso in tali fusi. **Correzione:** parsing di calendario locale già disponibile in `Logic`, più un'unica utility di navigazione. **Regressione:** Europe/Rome, America/New_York, Pacific/Honolulu, DST e cambio mese. Il precedente audit che dichiarava risolti tutti i navigatori non descrive questi percorsi attuali.

### LB-16 — Bozze e accessi storage non difensivi; data “oggi” non reattiva

**Categoria:** resilienza/UX · **Severità:** Medium · **Confidenza:** certo per gli accessi; ripristino mobile non verificato.

**Riferimenti:** `src/hooks/useNutritionMeasurements.ts:48–117`; `src/hooks/useLocalStorage.ts:11–14`; `src/components/Training/WorkoutTimer.tsx:6–25,44–54`; `src/components/Nutrition/NutritionView.tsx` (selectedDate).

Vari `getItem`/`setItem`/`removeItem` non sono protetti, a differenza della persistenza del workout. La bozza misure non include data/UID; il caricamento dipende dall'intero record nutrizione e può sovrapporsi agli input. La data selezionata inizializzata una volta nelle viste mantenute montate non avanza automaticamente a mezzanotte.

**Scenario/conseguenza:** storage che lancia eccezioni interrompe render/effect; una bozza di ieri può essere proposta oggi; un aggiornamento nutrizione può interferire con una misura non salvata. Il mantenimento di una data storica scelta intenzionalmente è invece corretto. **Correzione:** adapter storage con esito, envelope della bozza per data/UID e distinzione “segui oggi”/data fissata. **Regressione:** SecurityError, quota, cambio giorno/fuso, refresh dati durante digitazione e cambio account.

### LB-17 — Revoca Google Analytics non applicata all'SDK già inizializzato

**Categoria:** privacy tecnica · **Severità:** Medium · **Confidenza:** certo per implementazione/API; traffico dopo revoca non catturato.

**Riferimenti:** `src/lib/firebase.ts:84–132`; `src/App.tsx` (gating Vercel); `src/pages/PrivacyPolicy.tsx`.

La revoca imposta soltanto `analytics=null`: non disabilita la raccolta dell'istanza Google già inizializzata. Il callback asincrono di `isSupported` nel setter può inoltre inizializzarla dopo una revoca rapida. Firebase espone un'API esplicita per disabilitare la raccolta e una per il consenso. [Firebase Analytics API](https://firebase.google.com/docs/reference/js/analytics#setanalyticscollectionenabled).

**Conseguenza:** opt-out UI e stato effettivo della raccolta possono divergere nella pagina corrente; l'informativa descrive soprattutto Vercel, mentre è presente anche Google Analytics. **Correzione:** applicare lo stato all'SDK, riesaminarlo al completamento asincrono, verificare rete/cookie e aggiornare la descrizione tecnica. **Regressione:** opt-in→opt-out senza reload e true→false mentre `isSupported` è pendente; nessuna inizializzazione/raccolta incompatibile con lo stato corrente.

### LB-18 — Telemetria associata all'UID descritta come anonima e senza dati utente

**Categoria:** privacy/documentazione · **Severità:** Medium · **Confidenza:** certo per payload e descrizione.

**Riferimenti:** `src/lib/telemetryHub.ts:625–639,781–784,914–938`; `src/hooks/useWorkoutSession.ts:153`; `src/pages/PrivacyPolicy.tsx`; `docs/TELEMETRY_FIRESTORE_QUERIES.md:210–230`.

Gli eventi vengono scritti sotto l'UID, con session ID e `details` non passati dal sanitizer degli errori. L'evento di avvio include nome/ID routine. La coda guest può essere associata all'UID al login; la purge non rimuove `logbook_telemetry_queue`. Questo non corrisponde a “senza dati utente” o alla garanzia assoluta di zero dati allenamento. Non implica che tutte le metriche tecniche richiedano necessariamente lo stesso consenso analytics: quella è una decisione di policy da documentare correttamente.

**Conseguenza:** testo e dati effettivamente raccolti divergono; un nome routine libero può contenere informazioni personali. **Correzione:** whitelist di metadati necessari, rimozione dei nomi liberi, ciclo di vita della coda per UID, retention e descrizione fedele; revisionare la policy con il responsabile competente. **Regressione:** nome con dati personali, guest→login, logout/cancellazione, eventi offline e payload fuori whitelist. Le regex non sono una prova universale di anonimizzazione.

### LB-19 — Catalogo vuoto con versione valida e ripristino override non durevole

**Categoria:** catalogo/integrità · **Severità:** Medium · **Confidenza:** certo per condizioni statiche; dashboard catalogo non verificata.

**Riferimenti:** `src/lib/catalog/catalogService.ts:54–70,194–200`; `src/lib/catalog/seedExercises.json`; `src/lib/catalog/seedFoods.json`; `src/hooks/useTrainingExercises.ts:440`; `src/lib/db.ts:179–198`; `src/lib/catalog/deltaResolver.ts:98–103,168–174`.

I seed sono vuoti ma dichiarano versione `1.0.0`. Se il manifest remoto ha quella stessa versione/schema, il sync non scarica i documenti, indipendentemente dai conteggi. Un catalogo aggiornato in background non aggiorna direttamente lo store già risolto. Il ripristino esercizio usa ora il catalogo in memoria, quindi il vecchio bug del lookup in `defaultExercises` è superato; tuttavia il save fonde vecchi override con quelli estratti e non elimina una chiave solo perché l'esercizio è tornato al default. Il resolver deduplica inoltre per nome normalizzato, potendo nascondere entità con ID distinti.

**Conseguenza:** catalogo assente su cold start, override che torna dopo ricaricamento, perdita di varianti omonime. **Correzione:** seed con identità distinta/completezza verificabile, adozione atomica del catalogo e comandi espliciti di rimozione override; deduplica per identità. **Regressione:** cache vuota e manifest stessa versione; aggiornamento mentre l'app è aperta; modifica→salva→reload→ripristina→reload; due alimenti omonimi diversi.

### LB-20 — Piano nutrizionale e fine ciclo: fallback che alterano valori validi

**Categoria:** formule/dominio · **Severità:** Medium · **Confidenza:** certo, R16/R17.

**Riferimenti:** `src/hooks/useNutritionPlanning.ts:102–125`; `src/lib/calc/planning.ts:35–125`.

Il salvataggio usa `parseInt(onDaysCount) || 4`: zero giorni ON diventa quattro (R16). La timeline visualizza una `endDate` esplicita ma calcola fine/progresso usando `durationWeeks*7`: R17, inizio 1 settembre, fine 10 settembre, durata 1 settimana, al giorno 8 risulta già concluso.

**Conseguenza:** distribuzione ON/OFF e stato del ciclo non corrispondono agli input. **Correzione:** fallback solo per valori assenti/non validi, range espliciti e una singola fonte per durata/fine inclusiva. **Regressione:** 0/1/7 giorni, date non multiple di sette, giorno finale e successivo; verificare UI e calcolo insieme.

### LB-21 — Test stress non eseguibili con il comando documentato e coverage gate separato

**Categoria:** qualità/CI · **Severità:** Medium · **Confidenza:** certo.

**Riferimenti:** `package.json:14`; `vitest.config.ts:15–25`; `vite.config.ts:16–23`; `.github/workflows/test.yml:28–43`.

I glob quotati passati a `vitest run` sono filtri CLI e non selezionano i 49 file attesi nel comando osservato. Il lifecycle abilita correttamente le esclusioni condizionali, ma questo non rende validi i filtri. Le soglie coverage sono nel config Vite, mentre Vitest usa il suo config separato che non lo fonde. La CI pubblica coverage senza mostrare l'applicazione di quelle soglie.

**Conseguenza:** una parte ampia delle verifiche è esclusa dai normali check e il comando dedicato non la esegue; il badge verde non rappresenta le invarianti adversarial. **Correzione:** progetto/config stress con include reali, conteggio selezione obbligatorio e contratti aggiornati; collocare le soglie nel config effettivamente risolto. **Regressione:** comando da shell Windows e Linux seleziona tutti i file; un test sentinella fallito o coverage sotto soglia produce exit non zero.

### LB-22 — Controlli Rules statici, senza prova dell'autorizzazione reale

**Categoria:** sicurezza/verifica · **Severità:** Medium · **Confidenza:** certo.

**Riferimenti:** `tests/firestore_security_rules.test.ts`; `firestore.rules:35–130`; `firebase.json`; `tests/setup.tsx:193–221`.

I test leggono il testo e verificano pattern/whitelist. Non avviano un emulator né eseguono richieste con identità differenti. Il file Rules letto contiene owner check e default deny, ma quasi nessun vincolo strutturale sui valori root/mensili; il `userId` interno dei payload telemetria non è confrontato con quello autenticato. Quest'ultima assenza non permette da sola di scrivere sotto il path di un altro utente.

**Conseguenza:** una regressione semantica delle Rules potrebbe superare i test; un proprietario può memorizzare payload non conformi al modello applicativo. **Correzione:** suite Rules emulator con richieste reali e revisione dei vincoli utili; controllo della versione distribuita separato. **Regressione:** anonimo/A/B, root/subcollection/catalogo, campi extra, month ID invalido, create/update/delete e payload malformati. Nessuna Rules è stata modificata o distribuita durante questo audit.

### LB-23 — Dialogo globale senza gestione completa del focus

**Categoria:** accessibilità funzionale · **Severità:** Medium · **Confidenza:** certo per il codice; screen reader non provato.

**Riferimenti:** `src/components/UI/GlobalDialog.tsx:15–155`; `src/store/useDialogStore.ts`; `src/main.tsx:16–18`.

Il dialogo ha ruoli/etichette ARIA ma non gestisce focus iniziale, contenimento del focus, ripristino o Escape. Un overlay visivo non impedisce da solo la navigazione tastiera sugli elementi sottostanti. È inoltre presente un blocco globale di `gesturestart` che merita verifica per lo zoom assistivo.

**Conseguenza:** conferme importanti, incluso logout con dati pendenti, meno affidabili per tastiera e tecnologie assistive. **Correzione:** primitive accessibili condivise con focus, background inert e policy Escape; verificare zoom senza interferire con la prevenzione dello zoom automatico degli input. **Regressione:** Tab/Shift+Tab, Escape, focus di ritorno, VoiceOver e viewport stretto. Il `<dialog>` del confronto nutrizionale è una conferma semplice, non un editor complesso: non viene classificato automaticamente come violazione del divieto AGENTS.

### LB-24 — Ricaricamento PWA senza barriera sullo stato non salvato

**Categoria:** PWA/integrità · **Severità:** Medium · **Confidenza:** molto probabile, non riprodotto con upgrade reale.

**Riferimenti:** `src/components/UI/ReloadPrompt.tsx:83–94` (`handleUpdate`); `src/App.tsx:55–63`; `src/components/UI/BufferedInput.tsx:48–65,147–161`.

L'aggiornamento SW e il recupero da preload error possono ricaricare la pagina senza una barriera comune per bozze, cache e replica. `BufferedInput` ha un flush utile su blur/Enter/hidden, ma la sua deregistrazione al teardown non costituisce una persistenza garantita. Il comportamento dipende dagli eventi effettivamente emessi dal browser.

**Conseguenza:** aggiornamento mentre si scrive o nel debounce può perdere l'ultima modifica. **Correzione:** coordinare reload, flush e durabilità locale; mantenere possibilità di differire l'aggiornamento e recovery del dato non confermato. **Regressione:** upgrade reale fra due build con input focused, workout attivo e rete interrotta; preload error senza loop di reload.

### LB-25 — Costi di stato completo con storico pluriennale

**Categoria:** performance/architettura · **Severità:** Medium · **Confidenza:** certo per algoritmo e benchmark sintetico; impatto mobile non misurato.

**Riferimenti:** `src/store/slices/createDataSlice.ts:36–53`; `src/lib/db.ts:149–174`; `src/lib/db/db_nutrition.ts:27–43`; `src/lib/calc/analytics.ts:127–166`; `src/hooks/useAnalyticsWorker.ts`; `src/components/Data/DataHistory.tsx:35`.

Cache, serializzazione, diff e raggruppamento lavorano sull'intero `UserData`; il grafico calcola il volume di tutto lo storico prima di filtrare le settimane. Il worker sposta parte del calcolo ma aggiunge copia/trasferimento dei dati e fallback sul thread principale. TrainingHistory usa già Virtuoso; DataHistory e l'archivio alimenti hanno percorsi a mappa completa.

R22, 2600 sessioni/104000 serie/300 esercizi: JSON **7.888.162 byte**, serializzazione **96,47 ms**, parse schema **594,14 ms**, serie settimanale **218,97 ms** nell'ambiente desktop isolato. È una singola misura, non un percentile o un benchmark mobile; il dataset non simula il rendering né IndexedDB reale.

**Conseguenza:** costo crescente anche per una piccola modifica, frame persi o storage pressure su dispositivi lenti. **Correzione:** misurare prima i percorsi UI reali; persistenza/diff per dominio o mese, lookup per ID, filtro temporale anticipato, cache dei derivati e virtualizzazione mirata. **Regressione:** dataset 1/5/10 anni, budget p95 su dispositivo target, memoria e tempo di ripresa, includendo structured clone e worker.

### LB-26 — Segnalazioni moderate dev e debito di aggiornamento

**Categoria:** dipendenze/sicurezza · **Severità:** Low nel contesto runtime osservato · **Confidenza:** certo per audit/lockfile; sfruttabilità non dimostrata.

**Riferimenti:** `package.json:49`; `package-lock.json:2455,6645,6829,10839,11300`, catena `firebase-admin@14.3.0` → dipendenze Google Cloud/HTTP → `uuid`.

`npm audit` aggrega sei pacchetti coinvolti da una segnalazione moderate; non sono sei exploit indipendenti. L'advisory UUID riguarda v3/v5/v6 con buffer di destinazione e offset, non v4. La scansione delle sole dipendenze prod è pulita. `firebase-admin` è usato per tooling amministrativo e non risulta parte del bundle applicativo. [Advisory ufficiale UUID GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).

**Conseguenza:** rischio nel tooling da mantenere tracciato, senza evidenza di impatto remoto sul client. **Correzione:** aggiornare la catena con una combinazione supportata; verificare gli usi vulnerabili prima di classificare l'esposizione. Non applicare automaticamente il downgrade major suggerito da `audit fix`. **Regressione:** audit dev/prod separati e dry-run del tooling con fixture; niente seeding di produzione come test.

## 4. Architecture assessment

### Percorso operativo ricostruito

1. **Bootstrap:** import dei moduli Firebase/store, inizializzazione telemetria, catalogo da IndexedDB/seed, lettura cache utente, risoluzione catalogo e parsing prima del render. Le attese e gli accessi storage non hanno tutti la stessa protezione: un fallback presente non implica avvio offline sempre garantito.
2. **Autenticazione:** callback Firebase seleziona caricamento normale, default o migrazione guest. Il rendering viene sbloccato prima del completamento del caricamento. Il ramo normale protegge alcuni successi obsoleti; quello guest ha un diverso protocollo e usa direttamente il DB.
3. **Stato:** Zustand diviso in dati, sync e workout. I selettori stabili nelle viste principali sono una buona difesa contro loop di referenze. App e alcune viste sottoscrivono comunque porzioni ampie; le tab mantenute montate conservano form e sottoscrizioni.
4. **Salvataggio dati:** updater ottimistico → cache IndexedDB asincrona → debounce di 1000 ms → ultimo stato corrente → confronto con baseline globale → batch root/mensili → risultato → stato UI. Le Promise coalescenti sono gestite, ma un secondo batch può partire mentre il primo è ancora in volo. Non c'è una barriera unica per il commit locale e remoto.
5. **Workout:** persistenza localStorage con debounce di 300 ms, flush hidden e shield dal cloud; aggiornamento `activeWorkout` nello stato, ma nessuna replica autonoma a ogni modifica. Questa separazione è sensata solo se la UI e il logout ne conoscono la durabilità.
6. **Offline:** SDK Firestore con cache persistente multi-tab e outbox REST custom nel SW. Il browser può differire/eliminare processi; Promise.race non cancella il lavoro sottostante. I due meccanismi non condividono revisioni, deduplicazione o owner del completamento.
7. **Ritorno online/foreground:** il listener dello store elimina l'errore visivo; non è un comando esplicito di replay delle mutazioni non accodate. Il ritorno visible attende al massimo 1500 ms, poi carica e fonde. L'assenza di una revisione base rende ambigua la distinzione fra copia vecchia, dato sporco e cancellazione.

### Aspetti positivi verificati

- Separazione delle formule pure e degli schemi in moduli; accesso Firebase modulare e statico alle variabili `VITE_*`.
- Provider App Check Enterprise e controlli manuali delle primitive necessarie; nessuna assunzione nel codice principale di `isSupported` da `firebase/app-check`.
- Ritorno esplicito `rejected` in `DB.saveUserData` per permission denied: **da preservare**, non da mascherare come suggeriva un audit precedente.
- Filtro di `undefined` nei payload DB e controllo preventivo di dimensione; quest'ultimo misura JSON UTF-8, una stima prudenziale, non la dimensione esatta di storage Firestore.
- Timer basato su timestamp e ricalcolo visible. La presenza di `setInterval` come tick non costituisce il vietato timer a puro conteggio di tick.
- Cleanup dei listener principali in hook/menu/ReloadPrompt; listener dello store e SW legati alla vita dell'app. Non è stato dimostrato un leak generalizzato.
- Code splitting, chart lazy/worker, TrainingHistory virtualizzato, CSS nativo e dimensionamento globale degli input a 16 px.

### Configurazione e superficie di sicurezza

Le 8 variabili Firebase sono controllate in fail-fast; `DATABASE_URL` resta richiesta pur senza uso RTDB individuato. Le configurazioni client Firebase non sono automaticamente segreti. Non sono stati riportati nel documento valori di credenziali o token. `service-account.json` è ignorato; non risulta fra i file tracciati della baseline. Non è stato eseguito uno scanning completo di tutti i commit storici.

`vercel.json` imposta HSTS, nosniff, frame denial, referrer policy, Permissions-Policy e CSP senza `unsafe-eval`/`unsafe-inline` negli script. Conserva i domini Firebase/Google/Vercel necessari e permette immagini HTTPS e stili inline. È una configurazione ragionevole da verificare sugli header effettivamente serviti; non è una prova di assenza di XSS. La ricerca nei sorgenti non ha individuato `dangerouslySetInnerHTML` o chiamate `window.alert/confirm`; i valori visualizzati passano prevalentemente dal rendering React. Non è stato effettuato un penetration test autenticato.

La documentazione Firebase conferma che la cache web persistente non viene automaticamente cancellata fra sessioni. La purge applicativa non equivale quindi a pulire anche la cache SDK. [Firebase: persistenza offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline).

### GitHub e deployment effettivamente osservati

Sul commit sono disponibili due run **push**, entrambi conclusi con successo il 9 settembre:

| Run | Evidenza |
|---|---|
| [Run Tests 34366070684](https://github.com/gernotfound/logbook/actions/runs/34366070684) | Job 102514998811; log: 132/132 test `src/`, 1048/1048 integrazione |
| [Playwright Tests 34366070677](https://github.com/gernotfound/logbook/actions/runs/34366070677) | Job 102514998450; step Playwright riuscito, circa 12 s |
| [Status del commit](https://github.com/gernotfound/logbook/commit/5a04e97a367dc2245f239addacb2f475b1231452) | Vercel `success`, “Deployment has completed”, 14:53:05 UTC |
| [Ruleset 21862355](https://github.com/gernotfound/logbook/rules/21862355) | Attivo sul default branch; regole `deletion` e `non_fast_forward`, nessun required status check nel ruleset letto |

Il primo wrapper GitHub consultato restituiva zero run perché filtrava i soli eventi pull request: la successiva API GET con `head_sha` ha restituito i due run push. Non va usato il primo risultato per dichiarare assente la CI. Il ruleset letto non impone una PR o test obbligatori; eventuale branch protection separata e Vercel Deployment Checks non sono stati verificati. Lo status verde di un deploy non dimostra il blocco dei deploy futuri in caso di test falliti. Nessun workflow è stato rilanciato o modificato.

## 5. Data integrity assessment

### Classificazione e parità dei campi

| Dato | Classe/storage | Parità e limiti |
|---|---|---|
| `profile` | Root cloud + cache locale | Tipo/schema/default/mapping/Rules presenti; hydration cloud-first, restore ostacolato da `{}` |
| `library`, `customFoods` | Stato risolto; cloud custom + override | Rappresentazioni differenti intenzionali, ma limiti schema/ID/override non uniformi; backup alimenti assente |
| `routines`, `trainingCycles` | Root cloud | Mapping e whitelist presenti; riferimenti a esercizi/routine non garantiti da vincoli relazionali |
| `activeCycleId`, `activePains` | Root cloud | Mapping/schema presenti; esclusi dal backup ordinario |
| `nutritionPlanning`, `nutritionPlanningOrigin` | Root cloud | Mappati, origin whitelistato; default/null/assenza differiscono fra percorsi; restore origin assente |
| `supplements` | Root cloud | Mappati; limitazione array; consumi nello storico dipendono anche dalla libreria |
| `legalConsent` | Root cloud | Schema e mapping; aggiornamento dedicato cattura uno snapshot prima di await e può superare modifiche concorrenti; da includere nei test di revisione |
| `catalogOverrides` | Root cloud | Mappato e whitelistato; rimozioni/restore non equivalgono all'unione di mappe |
| `history` | Mensilizzato + cache | Tre mesi caricati normalmente; assenza di caricamento storico progressivo nei consumer trovati; replace di mese e tombstone mancanti |
| `nutrition` | Mensilizzato + cache | Stesso problema; comprende pasti, misure, sonno e assunzioni, quindi una sostituzione di giorno può toccare più domini |
| `activeWorkout` | Snapshot root cloud | Non è la fonte primaria della sessione del dispositivo; copia aggiornata in memoria ma non sempre replicata |
| `localWorkout` | Locale persistito, fuori UserData cloud | Shield dal fetch utile; flush della rimozione incompleto |
| `pendingConflicts` | Locale persistito | Intenzionalmente non cloud-root; perderlo nel link/reload è un bug di lifecycle, non una ragione per aggiungerlo alla whitelist senza progetto |
| Bozze, tab, timer | Locale persistito | Scope, parsing e gestione errori non uniformi |
| Sync health, timer JS, promise in volo | Effimero | Devono essere legati a UID/revisione per non descrivere il dato sbagliato |

Il documento root scritto dal DB contiene **13 chiavi**, coerenti con le 13 ammesse dalle Rules lette. `history`, `nutrition` e `pendingConflicts` non fanno parte di quel root. Il numero di chiavi da solo non verifica parità semantica: parser parziali, cataloghi risolti e backup seguono contratti diversi.

### Storico pluriennale e cancellazioni

I loader mensili vengono richiamati soltanto da `DB.loadUserData` con la finestra fissa; la ricerca dei relativi simboli e path nei consumer non ha trovato un caricamento su richiesta per mesi più vecchi. Un dispositivo con cache completa può quindi mostrare più dati di uno appena autenticato. Grafici annuali, storico ed export non dichiarano sistematicamente questa incompletezza. **Non si afferma che il fetch cancelli tutti i mesi remoti più vecchi:** il pericolo di replace nasce quando si scrive un mese incompleto, come descritto in LB-04.

Le cancellazioni sono operazioni locali su array/record, poi differenze fra snapshot. Senza una baseline condivisa e senza tombstone la fusione per unione non può distinguere “mai scaricato” da “eliminato”. La cancellazione di account usa query complete in memoria e batch chunked: sufficiente per il limite batch, non per atomicità, paginazione o garantire zero residui.

### Formule, unità e validazione di dominio

Esaminate le formule di volume/set, velocità cardio, distribuzione macro, TDEE, biometria/Navy, timeline e aggregati settimanali. Sono presenti guardie utili per denominatori non positivi, routine vuote e date locali. Non è stata svolta una validazione clinica delle formule né dell'appropriatezza dei target individuali.

Oltre a LB-20, restano aspetti da specificare con test di dominio: volume storico calcolato con peso corporeo/catalogo correnti; significato di “record” se confrontato con la sola sessione precedente; unità a pezzi e `servingWeight`; durata/frequenze del ciclo importato; range plausibili delle misure e parsing della virgola nei percorsi non BufferedInput. Non vengono elevati a finding di perdita dimostrata senza una specifica concordata o un caso UI completo.

`clearDay` in `useNutritionMeals.ts:254–259` sostituisce l'intero giorno e rimuove anche misure/sonno: non è stata trovata una chiamata nell'interfaccia corrente durante la ricerca mirata. È un rischio di API interna da coprire prima del riuso, non una cancellazione UI osservata. L'import nutrizione, invece, è raggiungibile ed è incluso in LB-08.

## 6. Test assessment

### Esiti e interpretazione

La sequenza richiesta è stata eseguita nell'ordine lint → test → build → E2E. Non tutti i comandi sono verdi, né è stata modificata la suite per farli passare.

- **Suite ordinaria:** 70 file, 1180 test, 99,79 s. Fallimenti: `tests/sync_indicator_and_toast.test.tsx:695`, timeout nel workload rapido; `src/views/HomeView.analytics.test.tsx:82`, testo del grafico non trovato. Nel rilancio isolato dei due file con `--maxWorkers=2`: 2 file/50 test passati in 10,84 s. Un run CI sullo stesso commit ha 1180 pass complessivi divisi in due comandi. Questo è compatibile con flakiness/saturazione locale, ma non ne identifica definitivamente la causa.
- **Stress:** comando npm fallito in circa 1,33 s per selezione vuota. Workaround con lifecycle stress e 49 nomi concreti: 112,95 s, 30 file passati/19 falliti, 811 test passati/60 falliti. Il codice di uscita del wrapper PowerShell iniziale era quello di `Get-Content`; l'esito Vitest è ricavato dal log e resta **fallito**.
- **E2E:** primo processo sospeso a lungo e interrotto. Il rilancio con timeout globale registra “1 passed (1.0m)” e “Timed out waiting 60s for the teardown for plugin setup to run”; errore esterno al test. Non è una regressione di asserzione dimostrata. La CI Linux sul commit riesce. Non è stato corretto il lifecycle del preview locale.
- **Typecheck aggiuntivo del config:** `tsc --noEmit --project tsconfig.node.json` passa. Ha rigenerato il file tracciato `tsconfig.node.tsbuildinfo`, ripristinato byte per byte da HEAD; working tree ricontrollato. Il precedente errore di import `defineConfig` non è più presente.

### Qualità delle prove

`tests/setup.tsx` simula globalmente Auth, Firestore, DB e IndexedDB. Il DB simulato salva con successo e può caricare lo stato dello store stesso; le Promise di pending writes sono già risolte. Alcuni test fanno unmock/override ed esercitano più codice reale, altri verificano solo la UI sopra questi contratti. Non si può inferire una garanzia di persistenza o autorizzazione dal numero totale di pass.

Nella suite stress fallita sono presenti attese obsolete: DB che deve lanciare anziché restituire un risultato, whitelist di 11 campi, export `db` precedente a `getDb`, sonno numerico legacy e classi/testi UI vecchi. Altri fallimenti interessano migrazione, import e propagazione errori. **60 test falliti non equivalgono a 60 bug indipendenti**: occorre triage per contratto; non cancellare le asserzioni solo per ottenere verde. Non è stata fatta una classificazione causale completa di tutti i 60 fallimenti.

I test Rules sono statici. L'unico E2E entra come guest, passa offline e simula hidden, ma **torna online prima di chiudere e riaprire la pagina**. Dimostra una porzione del ripristino locale, non avvio offline reale, multi-account, Firestore, App Check o background sync REST.

Il log CI di coverage sul solo comando `src/ --coverage` riporta **37,26% statements, 27,13% branches, 35,28% functions, 38,49% lines**. Sono percentuali del report prodotto da quel run/config, non la copertura combinata di tutti i test né una misura universale di qualità. La suite integration successiva non produce in quel workflow un report unificato. I sorgenti applicativi sono typechecked dalla build; test e altri tool/config non sono tutti inclusi nello stesso progetto TypeScript.

### Prove ancora necessarie per una decisione di rilascio affidabile

Suite browser con storage reale e Firebase emulato; cold start completamente offline dopo installazione; crash/reopen durante save; due browser e due account con completamenti controllati; Rules emulator; round-trip backup completo; Safari iOS/PWA reale, VoiceOver e layout a 320 px. I test JSDOM su larghezze CSS non misurano layout, touch target effettivi o rendering a 60 fps.

## 7. Technical debt

### Contratti e documentazione

`AGENTS.md` e i documenti satelliti sono utili come invarianti, ma diverse garanzie non sono soddisfatte lungo l'intero percorso. Gli audit di agosto contengono assoluti (“100%”, cancellazione atomica, piena conformità privacy, zero PII) che non sono trasferibili alla baseline attuale. In particolare:

| Affermazione precedente | Verifica attuale |
|---|---|
| Mascherare permission denied come offline | Contraddice AGENTS attuale e la distinzione `rejected`; proposta da non applicare |
| Catalogo raddoppiato al bootstrap | Il resolver ora filtra i default già risolti; restano problemi differenti in LB-19 |
| Ripristino usa `defaultExercises` vuoto | Lookup già cambiato al catalogo; resta la rimozione durevole dell'override |
| Tutti i navigatori data corretti | Falso per pasti/integratori, R21 |
| Portabilità completa e cancellazione atomica | Non sostenute da export e account lifecycle attuali |
| Nessun `forwardRef` | `BufferedInput`/`BufferedTextarea` lo usano; non è di per sé un bug né motivo urgente di riscrittura |
| Tutti i test/controlli superati | Esito storico, non una prova per il commit esaminato |

Il debito principale è la duplicazione dei contratti: merger guest, hydration, import; payload DB e schema root; dati custom e cataloghi risolti; due code offline. `any` e cast riducono la capacità del typecheck di individuare divergenze semantiche. La telemetria dichiara versione `1.0.0` in `telemetrySanitizer.ts:23`, mentre package/build sono 1.0.2: peggiora l'attribuzione delle regressioni.

### Tooling, asset e dipendenze

I 51 warning lint comprendono regole React su ref/immutabilità/effect/purezza e variabili non usate; non vanno descritti tutti come semplice pulizia. Non è stato dimostrato che ciascun warning sia un bug. L'assenza di errori lint non soddisfa un requisito di zero warning.

`scripts/check.cjs` dipende da una rappresentazione testuale precedente della logica; `resize_icons.mjs` contiene un percorso locale specifico; `seed-catalog.mjs` può pubblicare seed vuoti senza una barriera sufficientemente esplicita e non aggiorna tutto come una singola transazione atomica. Sono stati letti, non eseguiti. `.snyk` non dimostra l'esecuzione di Snyk nella CI: nei workflow letti c'è npm audit. Gli indici telemetria sono documentati, ma non risulta un file di indici distribuito dalla configurazione Firebase letta.

Gli asset sono stati inventariati: favicon/icone PNG/SVG, sprite, robots, sitemap, verifica Google e manifest generato. Non sono stati misurati contrasto dell'iconografia, safe area maskable o qualità visiva su dispositivi reali. File legacy come `NutritionMeasurements` e vecchi grafici vanno rimossi solo dopo verifica completa degli import/test: il loro semplice nome non prova che siano inutilizzati.

Versioni risolte principali: React/React DOM 19.2.8, Vite 8.2.2, TypeScript 7.0.2, Firebase 12.18.0, Zustand 5.0.15, Zod 4.5.4, Vitest 4.1.11, Playwright 1.62.1, Chart.js 4.5.1. `npm ls --depth=0` non ha segnalato dipendenze dirette invalide.

| Pacchetto | Installato → disponibile al controllo del 9 settembre | Valutazione |
|---|---|---|
| `@playwright/test` | 1.62.1 → 1.63.0 | Release verificata upstream; riallineare anche browser/test, non assumere compatibilità solo da semver |
| `lucide-react` | 1.40.0 → 1.43.0 | Aggiornamento opzionale con controllo rendering/bundle |
| `oxlint` | 1.81.0 → 1.82.0 | Le nuove regole possono cambiare l'esito lint |
| `react-virtuoso` | 4.18.12 → 4.18.13 | Verifica mirata dello scroll storico |
| `vitest`, `@vitest/ui`, `@vitest/coverage-v8` | 4.1.11 → 5.0.0 | Major, da aggiornare insieme in lavoro separato |

Vitest 5 richiede Node almeno 22.12 e Vite almeno 6.4: Node 24 della CI e Vite 8 soddisfano questi prerequisiti, ma ciò non dimostra compatibilità dei mock o della configurazione. [Migrazione Vitest](https://main.vitest.dev/guide/migration/). La release Playwright 1.63 è presente nell'upstream ufficiale. [Release Playwright](https://github.com/microsoft/playwright/releases/tag/v1.63.0). Le altre versioni disponibili sono quelle del registry interrogato da npm; non è stata verificata sperimentalmente la compatibilità di ogni aggiornamento.

### Bundle

Build client e SW riuscite. Principali chunk, kB raw/gzip: Firestore **512/150,32**; vendor **189,17/60,18**; Chart.js **189,35/65,86**; Training **199,87/52,05**; index **78,73/23,43**; store **75,55/20,86**; logic **72,14/21,83**; Zod **85,63/23,65**. Worker analytics circa **105,56 kB raw**. Precache: **43 risorse, 2299,15 KiB**; SW **17,93/6,18 kB**.

Questi numeri non sono il download iniziale totale: chunk lazy, precache e compressione HTTP hanno ruoli diversi. Il warning sull'import dinamico di `export.ts` è fondato perché lo stesso modulo è importato staticamente altrove. `analyze` esegue la stessa build Vite già effettuata; non è stato eseguito un secondo build identico solo per duplicare il comando. Non è stato misurato un profilo Lighthouse/Web Vitals di produzione.

## 8. Prioritized remediation plan

Le modifiche sono **soltanto proposte**. Per gli interventi strutturali, applicare il processo di piano e approvazione previsto da AGENTS prima di toccare codice o dati. Non serve approvare retroattivamente questo audit già autorizzato.

| Ordine | Intervento e dipendenze | Criterio di accettazione | Rollback |
|---|---|---|---|
| 1 | Proteggere recuperabilità: LB-01/02/08/10; definire formato backup prima di migrazioni | Fallimento locale non confermato; logout con dirty bloccato; round-trip completo; cancellazione parziale esplicita | Conservare snapshot/export originali; non eliminare vecchie cache/formati fino alla verifica del nuovo percorso |
| 2 | Fix circoscritti: LB-11/12/14/15/20 | ID stabili, porzioni preservate, fine workout idempotente, date corrette e zero ON preservato | Feature branch e revert codice; migrazione ID reversibile tramite mappa e copia del dato originale |
| 3 | Rimettere in funzione le prove: LB-21/22, E2E lifecycle | Stress seleziona 49 file attuali o elenco motivato aggiornato; Rules emulator; gate coverage effettivo; comandi riproducibili Windows/Linux | Config precedente disponibile, ma non dichiarare sicuro un rollback che disattiva i test; check visibile come non soddisfatto |
| 4 | Protocollo per UID/revisione, LB-03/05/06/13 | Vecchi completamenti ignorati; guest non perso; local dirty e cancellazioni riconciliati | Lettura compatibile dei vecchi envelope, migrazione copy-on-write, switch controllato; non riutilizzare cache senza owner |
| 5 | Persistenza mensile e unica outbox, LB-04/07 | Nessun replace incompleto; convergenza A/B; replay idempotente e owner corretto; timeout tardivo gestito | Versionare protocollo e payload; sospendere il writer nuovo preservando la coda, senza riattivare due writer concorrenti |
| 6 | Gateway/recupero schema e catalogo, LB-09/19 | N+1 non azzera dati; migrazioni legacy tracciate; restore override durevole | Backup raw, quarantine e doppia lettura durante transizione; catalogo precedente recuperabile |
| 7 | Consenso/telemetria/accessibilità/PWA, LB-16/17/18/23/24 | Opt-out effettivo, metadati minimizzati, focus corretto, update senza perdita | Disabilitare raccolta nuova preservando funzioni core; poter differire update; rollback senza ripristinare code appartenenti ad altri UID |
| 8 | Performance e manutenzione, LB-25/26 | Budget misurati su target, audit dev/prod separati, aggiornamenti supportati e verificati | Chunk/config/versioni precedenti nel lockfile; nessuna conversione distruttiva richiesta per ottimizzare rendering |

Dopo ogni correzione: lint, test, build e, per UI/flussi/testi/routing, E2E come richiesto dal progetto. I nuovi test devono attraversare i confini del bug: lo stato in memoria non prova IndexedDB; un mock `synced` non prova cloud; il testo Rules non prova autorizzazione. Prima di una modifica Rules serve un piano di test/deploy isolato e la procedura prescritta dal progetto, senza usare la produzione come banco di prova.

## 9. Final verdict

**Non approvato come baseline con garanzie complete di integrità e recovery.** Il codice compila e i percorsi comuni hanno copertura automatizzata significativa, inclusi workflow CI riusciti. Questo non compensa i casi confermati di perdita silenziosa, backup incompleto e cancellazione parziale non comunicata.

La priorità è correggere i confini di persistenza/lifecycle e renderli verificabili, poi migliorare performance e debito di manutenzione. Non emerge la necessità dimostrata di cambiare framework o riscrivere tutta l'app. Non si dichiara compromissione della produzione, né si certificano conformità legale, sicurezza delle Rules distribuite o funzionamento iOS senza le prove ancora mancanti.

L'audit copre tutte le aree richieste con profondità differente, esplicitata sotto. È concluso come analisi della baseline; i limiti indicati restano attività di verifica aperte, non test implicitamente superati.

## Appendice A — Copertura e limiti dell'ispezione

Inventario Git: **321 file tracciati**, **149 file sotto src esclusi i test**, **119 file `*.test.ts/tsx`**; circa **28.052 righe** nei file src non-test, inclusi dati/stili. Un E2E Playwright. Questi sono conteggi dell'inventario, **non** percentuali di copertura manuale. L'inventario ha incluso file nascosti tramite `rg --files --hidden` e `git ls-files`; esclusi dall'analisi applicativa gli interni `.git`, `node_modules`, output dist/coverage/report e cache dei tool. Le dipendenze sono state esaminate attraverso lockfile, registry, audit e moduli pertinenti, non lette integralmente.

| Area | Profondità effettuata | Limite |
|---|---|---|
| Istruzioni/documenti | AGENTS, allegato utente, README, sei documenti di dominio, debug background sync, guide telemetria, audit agosto e REFACTORING_PLAN letti; passaggi rilevanti confrontati col codice | Esempi di query non eseguiti su produzione; affermazioni storiche non assunte vere |
| Bootstrap/Auth/store/DB/SW | Lettura dei percorsi core e ricerca completa dei consumer; tracing errori, default, retry, reset e successi tardivi | Non ogni interleaving browser/backend è riprodotto |
| Tipi/schema/merge/export/catalogo | Confronto delle rappresentazioni e riproduzioni dei casi prioritari | Non esaurite tutte le combinazioni di campi legacy/passthrough |
| Training/Nutrition/Data | Hook di mutazione e formule esaminati; viste/editor/righe/menu letti per i flussi pertinenti; ricerca trasversale date, listener, dialoghi, storage, rendering | Non review riga per riga di tutti i 149 file; componenti presentazionali, SVG e CSS esaminati a campione/pattern |
| Privacy/consenso/telemetria/App Check/CSP | Payload, callback, policy descritta, code e configurazioni letti; confronto API Analytics | Nessun tracciamento di rete autenticato né console privacy/App Check |
| Test | Config/setup, Rules, E2E, test pertinenti a persistenza/merge/logout/export/telemetria e fallimenti esaminati; suite ordinaria e stress eseguite | Non lettura integrale di tutte le 119 suite; triage dei 60 fallimenti stress non completo |
| Script/config/asset | Inventario e lettura config operative, workflow, script, robots/sitemap, manifest e riferimenti asset | Script admin non eseguiti; PNG/SVG non sottoposti a QA visuale completa |
| Dipendenze/bundle/CI | Lockfile, npm ls/audit/outdated, build e risultati GitHub del commit | Nessun aggiornamento, scansione Snyk o compatibilità sperimentale di versioni nuove |

Verifiche rimaste non effettuate o non verificabili con le evidenze raccolte: Safari/PWA su hardware iOS, VoiceOver, test offline cold start completo, Firestore Rules emulator, App Check enforcement, contenuto dei cataloghi di produzione, Cloud/Vercel dashboard, branch protection separata, policy retention/backup server, header realmente distribuiti, carichi di produzione e disponibilità/quota reali. Non sono marcate come conformi.

## Appendice B — Registro dei comandi e degli impedimenti

| Comando/gruppo | Esito, durata disponibile e note |
|---|---|
| `git rev-parse HEAD`, `git status --short`, remote, Node/npm | Baseline e pulizia verificati all'avvio e alla ripresa; nessun commit/push |
| `rg --files --hidden …`, `git ls-files`, `rg -n …`, `Get-Content …` | Inventario, ricerca simboli e lettura; alcune letture grandi troncate, poi suddivise sui passaggi rilevanti; nessuna pretesa di lettura integrale basata su output troncato |
| `npm run lint` | Exit 0; rilancio per registrare warning: 51. Durata esatta del primo comando non conservata |
| `npm run test` | Exit 1; 99,79 s; 1178 pass/2 fail |
| `npm run build` | Exit 0; durata totale non conservata nel registro sintetico; warning e dimensioni documentati |
| `npm run test:e2e` | Primo processo interrotto dopo attesa prolungata, durata precisa non conservata |
| `npm run test:stress` | Exit 1; circa 1,33 s; nessun file selezionato |
| Vitest stress con file espliciti e `--maxWorkers=2` | 112,95 s; 811 pass/60 fail; output nel TEMP, non aggiunto al repository |
| `npm run test -- --maxWorkers=2 tests/sync_indicator_and_toast.test.tsx src/views/HomeView.analytics.test.tsx` | Exit 0; 10,84 s; 50 pass |
| `npm run test:e2e -- --global-timeout=60000 --reporter=line` | Scenario passato; timeout teardown a 60 s; processo interrotto, non exit di successo |
| `npm audit --json`, `npm outdated --json` | Primi tentativi impediti da accesso rete/cache nel sandbox; rieseguiti con autorizzazione di rete; exit 1 coerente con segnalazioni/aggiornamenti; nessuna installazione |
| `npm audit --omit=dev --json` | Exit 0, circa 2,9 s; zero segnalazioni |
| `npm ls --depth=0` | Exit 0; versioni dirette lette |
| `tsc --noEmit --project tsconfig.node.json` | Exit 0, circa 1,6 s; artefatto tsbuildinfo generato e ripristinato esattamente da HEAD |
| Harness Node nel TEMP | 22 risultati sintetici; primi tentativi di transpiling/sintassi corretti solo nel TEMP; ultimo run exit 0 |
| GET GitHub run/status/ruleset/jobs/log | Due run push riusciti, status Vercel, ruleset e step/log letti; nessuna mutazione remota |

Le durate non conservate sono dichiarate mancanti: non sono state inventate né sostituite con quelle dei vecchi audit. La build genera gli output ignorati `dist`; Playwright genera i propri report ignorati. Gli strumenti temporanei e i log si trovano sotto `%TEMP%`, fuori dai sorgenti. L'unico artefatto tracciato rigenerato dal typecheck aggiuntivo è stato ripristinato. Il controllo finale `git status --short` mostra soltanto `?? audit_logbook_2026.md`; il report è UTF-8 senza BOM e senza caratteri Unicode sostitutivi.

Comando stress effettivo, riproducibile dalla root in PowerShell senza cambiare la configurazione:

```powershell
$env:npm_lifecycle_event = 'test:stress'
$auditStressFiles = @(rg --files tests | Where-Object { $_ -match 'challenger_|adversarial|stress' })
& .\node_modules\.bin\vitest.cmd run --maxWorkers=2 @auditStressFiles
$auditStressExit = $LASTEXITCODE
Remove-Item Env:npm_lifecycle_event
exit $auditStressExit
```

## Appendice C — Riproduzioni isolate e scenari avversi

Harness temporaneo: `logbook-audit-repro.cjs`, eseguito dalla root. Carica i moduli TypeScript reali con strip dei tipi Node e trasformazione CommonJS tramite Babel già installato. Sostituisce i confini Firebase, IndexedDB, localStorage, timer e hook con adapter minimi in memoria. Non interpreta TSX né esegue una pagina reale. Per R21 riproduce esattamente l'aritmetica date dei due handler; per R22 misura le funzioni pure. Ogni mondo riparte da cache e storage separati.

| ID | Ingresso/interleaving | Risultato osservato |
|---|---|---|
| R01 | Schema root, 501 esercizi con ID valido | Array risultante vuoto |
| R02 | DomainParser, alimento con ID numerico 123 | Elemento scartato |
| R03 | Nuovo alimento valido → resolver | Nessun ID; alimento filtrato |
| R04 | Locale con sessione cancellata nel cloud e profilo differente | Sessione preservata, profilo cloud prevalente |
| R05 | Due pasti stesso ID, tempi diversi; merge del giorno con sé stesso | 2 → 1 |
| R06 | `safeNumber('Infinity')` | Numero infinito ammesso |
| R07 | `sleepHours:7.5` legacy | Campo non conservato |
| R08 | Save prima del timer 1000 ms | syncing true, health synced |
| R09 | IndexedDB rifiutato, save guest | Risultato synced, niente dato persistito |
| R10 | Save pendente, reset, poi rifiuto vecchio | Errore/health vecchi applicati allo store resettato |
| R11 | Risoluzione locale, UID diverso non vuoto, save rifiutato | Conflitto rimosso, piano locale attivo |
| R12 | Workout null, hidden prima di 300 ms | Vecchio workout ancora nel disco simulato |
| R13 | Backup UserData con campi valorizzati | Campi indicati in LB-08 omessi |
| R14 | Import backup in default `{}`/piano 80 | Profilo vuoto e piano 80 mantenuti |
| R15 | Import del JSON d'emergenza | Formato non supportato |
| R16 | Save piano con 0 giorni ON | Diventa 4 |
| R17 | Fine esplicita 10 settembre, durata 1 settimana, oggi 8 settembre | isEnded true |
| R18 | Sync di un giorno di maggio non presente nella baseline locale | Replace del mese senza merge |
| R19 | Timeout wrapper, poi completamento sottostante | Timeout osservato e commit tardivo possibile |
| R20 | Query cancellazione fallite e batch permission denied | Funzione riuscita e identità simulata eliminata |
| R21 | Handler date in America/New_York, 2026-09-09 | Prec. 2026-09-07; succ. 2026-09-09 |
| R22 | 2600 sessioni, 104000 serie, 300 esercizi | 7,89 MB JSON; parse ~594 ms, calcolo ~219 ms |

Chiusura durante salvataggio, cambio utente, dati corrotti, conflitti e timeout sono quindi coperti **a livello isolato**, non tutti end-to-end. La riconnessione browser/SDK/SW, il link guest completo, la doppia submission reale e la concorrenza fra dispositivi sono seguiti nel codice e proposti come regressioni, ma non riprodotti contro un backend. La mezzanotte è stata esaminata nel lifecycle delle viste; non è stato fatto avanzare un dispositivo iOS reale oltre la mezzanotte. Questa distinzione evita di trasformare un test di funzione in una promessa di resilienza mobile.

## Appendice D — Fonti esterne

Consultate durante la raccolta del 9–10 settembre; i risultati npm sono riferiti al 9 settembre. I link GitHub del repository richiedono l'accesso al repository privato.

- [Firebase — persistenza offline Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline): comportamento della cache e conflitti sul documento.
- [Firebase — API Analytics](https://firebase.google.com/docs/reference/js/analytics): abilitazione raccolta e consenso, per LB-17.
- [UUID — advisory GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq): ambito della segnalazione moderate, CVE-2026-41907.
- [Vitest — guida migrazione](https://main.vitest.dev/guide/migration/): prerequisiti e necessità di revisione per la major 5.
- [Playwright — release 1.63.0](https://github.com/microsoft/playwright/releases/tag/v1.63.0): verifica dell'aggiornamento disponibile.
- [GitHub — run unit/integration della baseline](https://github.com/gernotfound/logbook/actions/runs/34366070684), [run E2E](https://github.com/gernotfound/logbook/actions/runs/34366070677), [ruleset letto](https://github.com/gernotfound/logbook/rules/21862355): evidenze operative, senza inferire protezioni non lette.

Le fonti esterne supportano i rispettivi comportamenti/API o advisory. Le conclusioni sul progetto derivano dal codice e dalle prove descritte, non dalle rassicurazioni degli audit precedenti.
