# LogBook — rinnovo grafico iPhone, opaco e accessibile

Data: 16 settembre 2026. Baseline esaminata: `a986f1143bb558add69ec35c13fb1e3c195ecaab`.
Branch dedicato: `codex/redesign-ios`, creato dalla baseline. Stato: **approvato dall'utente il 16 settembre 2026 con "Procedi"; implementazione in corso**.

## Vincolo aggiunto il 17 settembre 2026

L'utente segnala nuovi aggiornamenti su `main` e richiede che questo branch contenga solo il rinnovo grafico. Non integrare né sovrascrivere `main` durante il lavoro. Un eventuale merge futuro dovrà portare le modifiche di presentazione conservando la logica aggiornata di `main`; esaminare i conflitti componente per componente. Le sole variazioni di comportamento ammesse qui riguardano presentazione e accessibilità (tema locale, navigazione ai pannelli esistenti, visibilità del resoconto), senza modificare calcoli, Domain Operations, autenticazione, sync o modello dati.

## 1. Obiettivo e decisioni confermate

Rinnovare l'intera interfaccia conservando le funzioni, l'affidabilità offline e la struttura di navigazione. L'ispirazione iPhone riguarda gerarchie, tipografia, spazi e comportamento dei controlli. Il risultato resta una PWA compatibile anche con Android e desktop.

- Fondo nero pieno in scuro, superfici opache, nessun effetto vetro, blur o glow. Tema chiaro progettato separatamente.
- Ciano come accento principale di LogBook; colori secondari vivaci per dati e stati, ispirati alla saturazione di `gmz-base`, senza copiarne lo stile arcade.
- Scelta Sistema / Chiaro / Scuro in Impostazioni. Default Sistema, secondo la scelta espressa; l'anteprima grafica parte in Scuro per mostrare la preferenza estetica principale.
- Conservare Home, Allenamento, Nutrizione, Dati e Impostazioni nella barra inferiore, e le sottosezioni esistenti in alto.
- Esercizi e serie sempre aperti durante l'allenamento. Nessun nuovo percorso obbligatorio a esercizio singolo.
- Timer recupero sticky in alto, manichino con settori muscolari e resoconto post allenamento obbligatori.
- Dispositivi di riferimento: iPhone 15 Pro Max e Windows 11 con Chrome; layout da 320 CSS px, tablet e desktop. Versione iOS e prova Safari/PWA installata da rilevare durante il collaudo reale.
- Nessun nuovo servizio a pagamento, dipendenza runtime, font remoto o libreria UI. CSS nativo e Lucide già disponibili.
- Prima prova utente tramite modalità senza account su Vercel Preview del branch. Nessun merge in `main` finché l'utente non approva il risultato provato.

## 2. Contratto visivo e interazioni

### Fondazioni

- Centralizzare colori semantici di sfondo/superficie/testo/bordo/azione/stato/grafico, tipografia, spazi, raggi e livelli sovrapposti. Conservare alias dei token esistenti fino alla migrazione di tutti i consumer, inclusi grafici e SVG.
- Scuro: sfondo `#000000`, superficie `#171719`, testo `#f6f7f9`, testo secondario `#a4a9b2`, ciano `#00e5ff` con testo `#071214`. Chiaro: fondo `#f3f4f6`, superficie bianca, testo `#161719`, secondario `#5b626b`, ciano `#006978` con testo bianco. Contrasti calcolati per i pulsanti: 12,35:1 in scuro e 6,38:1 in chiaro; secondari rispettivamente 7,58:1 e 6,17:1 sulle card. Verificare separatamente tutte le altre coppie e gli stati interattivi.
- Font di sistema, a partire da `-apple-system` e `BlinkMacSystemFont`; corpo 1rem, testo secondario almeno 0.875rem, titoli con scala coerente in rem. Input/select/textarea mantengono 16px `!important`. Cifre tabulari per timer e colonne numeriche.
- Spazi basati su 4/8/12/16/24/32 px, espressi in rem nei componenti. Margini mobili 16 px, 12 px alle larghezze minime. Card con raggio 20 px, pulsanti principali 14 px, campi 12 px. Le dimensioni sono baseline progettuali; il testo ingrandito deve far crescere i contenitori.
- Comandi principali min-height 52 px; secondari, input e pulsanti a icona almeno 44×44 px. Icone di norma 20–24 px. Distinguere visivamente azione primaria, azione secondaria e azione distruttiva; evitare cestini accanto ai campi più usati.
- Contrasto WCAG AA: testo normale almeno 4,5:1; testo grande e segni essenziali di controlli/grafici almeno 3:1. Stato selezionato riconoscibile anche dalla forma/indicatore, non soltanto dal colore. Focus visibile, nomi accessibili, riduzione movimento.

### Navigazione e schermate

- Barra inferiore opaca con cinque destinazioni e relative etichette. Conservare keep-alive, bozze, tab persistiti, scorciatoie e ripristino dello scroll; nessun cambio di router.
- Sottosezioni in una riga orizzontale scorrevole, larghezza adeguata al testo, tab selezionato portato in vista e indicazione discreta delle voci oltre il bordo. Non ridurre i caratteri per costringerle tutte nella stessa riga. Implementare associazioni tab/pannelli e navigazione da tastiera.
- Home: rendere raggiungibile il comando di avvio già esistente anche prima di un workout odierno; stato di sessione in corso con accesso diretto; poi nutrizione, biometria, recupero/manichino e grafici. Nessuna funzione analitica eliminata. Le macro senza obiettivi individuali verificati mostrano quantità e unità, non barre con target inventati.
- Allenamento: timer opaco sticky con etichetta Recupero, start/pausa, riavvio e stop. Durata totale distinta. Mantenere cronometro crescente manuale, timestamp persistiti e ricalcolo al ritorno dal background.
- Serie: kg/ripetizioni e varianti cardio/isometrie/dropset devono restare leggibili e modificabili; su 320 px spostare azioni secondarie su una riga aggiuntiva invece di comprimere i campi. Esercizi e serie tutti aperti; storico, riordino ed eliminazione nel menu contestuale esistente, con feedback immediato. Nessuna nuova spunta di completamento serie o nuova metrica implicita.
- Manichino: riusare geometria e mappature esistenti, adattare riempimenti/contorni ai due temi, aggiungere nome accessibile e selezione testuale equivalente. Muscoli, affaticamento e dolore conservano il loro significato; nessuna nuova valutazione medica.
- Resoconto: vista risultato a pagina intera, ritorno esplicito, safe area e focus gestiti. Mostrare durata, esercizi, volume e confronto con sessione precedente; chiamare i miglioramenti per quello che il calcolo effettivamente misura, senza presentarli come record assoluti. Conservare accesso dallo storico e Salva come scheda per le sessioni libere.
- Nutrizione e Dati: uniformare selettori giorno, unità, campi numerici, elenchi, grafici, ricerca e form inline. Conservare navigazioni storico/modifica e tutti i campi attuali. Impostazioni: gruppi Aspetto, Account, Privacy, Esporta/ripristina, senza duplicare azioni.
- Estendere il tema a login, consensi, errore/caricamento/vuoto/offline, installazione, aggiornamento PWA, conflitti e cancellazione account. Il banner guest entra nel layout; nessun offset fisso che presuma una sola riga di testo. Avvisi, timer, tastiera e barra inferiore devono poter convivere.

## 3. Implementazione e confini tecnici

### Tema e componenti

Punti di ingresso principali: `src/styles/global.css`, `src/App.tsx` e i componenti delle cinque sezioni. Creare componenti condivisi solo per pattern realmente ripetuti: intestazione, selezione giorno, campo etichettato e azioni/menu. Conservare CSS nativo, classi tipografiche e controlli HTML semantici; migrare gli stili inline statici gradualmente per famiglia di componenti.

La preferenza di tema è **application/local-only**, indipendente dall'account: `ThemePreference = 'system' | 'light' | 'dark'`, `ResolvedTheme = 'light' | 'dark'`. Nessuna modifica a UserData, schema cloud, Firestore Rules, formato backup o versioni del protocollo. Gestire cambio preferenza OS e sincronizzazione tra schede dello stesso origin; fallimento dello storage non deve impedire l'uso del tema nella sessione corrente.

Il target del bundler installato, letto nel codice di Vite, include Chrome/Edge 111, Firefox 114 e Safari/iOS 16.4. È un target di trasformazione del codice, non una certificazione di tutte le API dell'app. Il redesign non lo innalza: usare token CSS con `data-theme` e fallback, evitando di rendere essenziali funzioni CSS più recenti. Le prove automatizzate sui browser correnti e quelle sul dispositivo reale restano necessarie.

Applicare il tema prima dell'interfaccia iniziale con un piccolo bootstrap esterno stesso origin, compatibile con la CSP attuale. Evitare nuovi script inline o allentamenti CSP. Sincronizzare `data-theme`, `color-scheme`, loader e meta theme-color; registrare il bootstrap nella cache PWA esistente. Prevedere fallback CSS al tema del sistema se il bootstrap non è disponibile. Verificare separatamente la resa della barra di stato nella PWA installata, senza presumere aggiornamenti dinamici nativi.

Con l'attuale `black-translucent` di iOS, se le icone di sistema rimangono chiare passando al tema chiaro, mantenere uno sfondo scuro opaco nella sola area superiore di sicurezza in modalità standalone. L'interfaccia sottostante resta chiara; icone di sistema leggibili sono il criterio di accettazione. Non simulare una status bar o una Dynamic Island nel prodotto.

Leggere i colori risolti per i canvas Chart.js e ridisegnarli al cambio tema. Preservare gli output numerici, la virtualizzazione e i confini memo; i tick del timer non devono ridisegnare tutte le serie. Rimuovere blur e animazioni decorative continue, senza alterare la sicurezza dei feedback di salvataggio.

### Difetti verificati collegati al rinnovo

- **Resoconto:** riprodotto nella copia locale con sessione libera vuota: dopo il salvataggio torna la schermata di avvio senza report; lo storico contiene la sessione. Spostare lo stato di presentazione del report dal componente che viene smontato al termine a `TrainingSession`, che sopravvive al cambio di `localWorkout`. Il callback di completamento passa la sessione già salvata; nessuna seconda scrittura e nessun cambiamento a `endWorkout`/Domain Operations per far comparire la vista.
- **Home:** correggere la condizione che nasconde il widget quando manca un workout giornaliero, riusando il comando già presente. Eliminare la comunicazione visiva di obiettivi macro basati sui denominatori fissi 300/150/80 g: mostrare valori, finché non esiste un target reale utilizzabile.
- **Layout guest:** osservato banner sopra il titolo e i sottotab nel viewport mobile. Gestire altezza reale e safe area, evitando sovrapposizioni con il timer.
- **Worker grafici:** baseline locale registra cancellazioni per unmount come errori di calcolo. Distinguere cancellazione attesa da guasto; mantenere osservabile il guasto e il fallback quando la vista è montata. Non disattivare StrictMode e non sopprimere globalmente i log.

Preservare `localWorkout`, flush delle bozze, commit locale, errori di persistenza, sincronizzazione e reload barrier. Lo schema dati e i calcoli fitness restano fuori dalla migrazione grafica. I limiti esistenti dei confronti e delle stime non devono essere amplificati da nuove etichette o figure.

### Lotti

1. Approvazione di questo piano e della direzione visiva; primo prototipo dimostrativo separato dal codice applicativo.
2. Fondazioni chiaro/scuro, bootstrap, controlli e navigazione; migrazione di loader/login/avvisi e aggiornamento delle regole grafiche locali da glassmorphism a superfici opache.
3. Allenamento, manichino e report, con regressioni comportamentali pertinenti.
4. Home, Nutrizione, Dati, Impostazioni, form secondari e grafici; controllo di tutte le schermate censite in entrambi i temi.
5. Revisione, gate canonico, Preview del branch e prova utente senza account. Le correzioni restano nel branch fino all'accettazione.

## 4. Verifiche e criteri di accettazione

Il contratto CI locale è stato verificato con `node scripts/check-ci-contract.mjs` (exit 0). **Non è stato eseguito il gate completo in questa fase di progettazione.**

- Test tema: sistema e override manuale, preferenza assente/corrotta, storage non disponibile, cambio OS, cambio tra tab, ricarica e avvio offline; assenza di flash del tema errato nel loader con preferenza salvata.
- Test workout: input ancora focalizzato al termine, report visibile dopo commit e fino a chiusura, riapertura dallo storico, completamento singolo, fallimento persistenza con sessione conservata, timer start/pausa/riavvio/stop e ripresa dopo background/reload/cambio proprietario.
- Resoconto con fixture popolata: due esercizi, più serie modificate e una sessione precedente confrontabile; verificare durata/volume/differenze e Salva come scheda della sessione libera. La prova della sessione vuota non sostituisce questa verifica. Chiusura del report finale verso Home, chiusura da storico verso storico.
- Test Home: comando avvio prima della prima sessione, ripresa sessione, nessun finto target macro; menu e selezione giorni accessibili. Test lifecycle worker sotto StrictMode, cancellazione attesa e guasto reale.
- Browser reali automatizzati: Chromium e WebKit; larghezze 320/375/430/768/1280 px, entrambi i temi, contenuto lungo e vuoto. Misurare bounding box, touch target, overflow, timer sticky, ultimo campo sopra la navigazione, focus e contrasto. Firefox per smoke delle sezioni e tema. Non considerare i vecchi test con geometria simulata una prova di layout.
- Accessibilità: zoom/testo al 200%, tastiera, focus dialog/menu e ritorno, selected state tab, etichette/input, lista testuale muscoli e reduced motion. Icone funzionali Lucide con nome accessibile; nessuna informazione solo al passaggio del mouse.
- iPhone reale: Safari e icona PWA, tastiera nei campi serie e pasti, notch/home indicator, rotazione, scroll, blocco/sblocco, ritorno all'app, offline e aggiornamento differito con workout attivo. Registrare modello e iOS effettivi. L'emulazione su Windows non certifica questi punti.
- Validazione finale su commit esatto e worktree pulito: `npm run verify:m8`; mantenere job `Canonical Verification`. I test pertinenti durante i lotti non sostituiscono il gate. Aggiornare i selettori E2E quando cambiano etichette, senza indebolire i controlli.
- Il workflow corrente parte su PR verso main o dispatch, non sul solo push del branch. Usare PR draft o dispatch per la verifica; aggiungere installazione WebKit/Firefox in step separati se entrano nella CI, preservando lo step Chromium e il contratto corrente.

## 5. Anteprima, rischi e rollback

- Vercel: progetto `logbook` verificato su piano Hobby; repo GitHub privata verificata. Pubblicare soltanto Preview dal branch, riusando integrazione e progetto esistenti. Non abilitare servizi, acquisti o piano superiore.
- Condividere l'alias stabile del branch restituito da Vercel, senza inventarne l'URL: cambiare origin cambia lo spazio locale dei dati guest. Segnalare la modalità di prova e mantenere il medesimo alias tra le iterazioni quando disponibile.
- Provare senza account: i dati inseriti restano nel browser di quell'anteprima. Un accesso futuro allo stesso Firebase dell'app principale può invece modificare gli stessi dati cloud; il semplice branch non crea un database separato. Non cambiare Auth/Firestore per questo redesign.
- Verificare protezioni/Deployment Checks effettivi prima di affermare che il deploy sia subordinato alla CI. Preview pronta e gate superato sono evidenze distinte.
- Rischi principali: token mancanti, colori inline residui, focus o bozze persi durante refactor, tastiera che copre comandi, report smontato e cambio tema dei grafici. Contromisure: migrazione per componenti, inventario dei token, test comportamentali e misure nel browser.
- Prima dell'accettazione, rollback = chiudere l'anteprima e continuare a usare produzione invariata. Dopo un eventuale merge approvato, revert dei commit del redesign senza cancellare storage utente; nessuna migrazione dati da invertire. Conservare il reload barrier anche in rollback.
- Il tema non promette funzioni native come Live Activities, timer in Dynamic Island o avvisi puntuali a schermo bloccato. Nessuna percentuale di risparmio batteria viene garantita.
- Eventuale lavoro esterno a un'altra chat limitato a inventari o calcoli riproducibili, senza credenziali/dati personali; integrazione, decisioni e test rimangono qui. Per questa fase i calcoli di contrasto sono eseguibili direttamente tramite script.

### Fonti tecniche consultate

- [Apple — Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) e [Typography](https://developer.apple.com/design/human-interface-guidelines/typography): aree di interazione e gerarchia. Le misure CSS proposte sono scelte web da collaudare, non conversioni in unità CSS pt.
- [WebKit — Safe area](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) e [MDN — VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport): margini e tastiera. `100dvh` da solo non certifica la geometria a tastiera aperta.
- [MDN — Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API): limitazioni dei timer in background.
- [W3C — Contrasto testo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) e [contrasto non testuale](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html): criteri misurabili.
- [Apple — Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities): distinzione fra PWA e integrazioni native.
