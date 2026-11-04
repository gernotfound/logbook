# Design System — TheLogBook

**Quando leggere:** tema, CSS/token, bootstrap iniziale, viewport, focus e accessibilità.
**Non inferire:** un test WebKit non certifica una PWA installata su iPhone reale.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Tema adattivo

La presentazione usa superfici, controlli e navigazione ispirati alle app iPhone, conservando un layout leggibile su schermi piccoli e desktop. `src/styles/global.css` importa i moduli `tokens.css`, `base.css`, `components.css`, `utilities.css`, `context-menu.css` e `ui-surfaces.css`. Le sezioni possono importare il proprio CSS.

`tokens.css` definisce i temi dark e light. Usare token semantici, non colori di testo fissati per il solo tema scuro:

- Superfici e testo: `--bg-color`, `--surface-color`, `--surface-light`, `--text-main`, `--text-muted`, `--glass-border`.
- Azioni e relativi colori leggibili: `--primary-color`/`--on-primary`, `--accent-color`/`--on-accent`, `--warning-color`/`--on-warning`, `--success-color`/`--on-success`, `--danger-color`/`--on-danger`.
- Grafici e mappa: `--chart-grid`, `--muscle-base`, `--muscle-outline`, `--muscle-active`, `--muscle-recent`, `--muscle-pain`.

La scelta `system | light | dark` è una preferenza del dispositivo salvata best-effort nella sola chiave `logbook:appearance:v1`. `index.html` carica `public/appearance.js` e `public/appearance.css` prima del bundle React: lo script imposta il tema e il CSS colora la pagina già al primo disegno.
La splash di caricamento segue il tema risolto ed è esclusivamente in bianco e nero: in tema scuro usa sfondo nero, mascotte e scritta bianche; in tema chiaro usa sfondo bianco, mascotte e scritta nere, senza riquadri cromatici attorno all'SVG. Il titolo di caricamento è intenzionalmente “CARICAMENT” in maiuscolo grassetto, seguito da uno spinner circolare che rappresenta la O finale; lo spinner ruota senza pulsazioni o bagliori e diventa una O ferma con le preferenze di movimento ridotto.
Il markup bootstrap di `index.html` e gli stati React bloccanti/lazy usano le stesse classi `brand-loading-screen*` definite in `public/appearance.css`; il componente React canonico è `src/components/UI/BrandLoadingScreen.tsx`.
La variante `content` mantiene esattamente proporzioni, spaziatura, testo e spinner della variante fullscreen e riduce uniformemente l'intero gruppo, centrandolo nell'area utile sopra la bottom navigation; non ridimensionare separatamente mascotte o testo.
Entrambe le varianti sono overlay fissi e non scrollabili: durante la loro presenza il documento non deve poter scorrere, mentre la variante `content` lascia accessibile la bottom navigation. `useAppearanceStore` ascolta le variazioni del sistema e delle altre schede. **MUST:** non mettere questa scelta in `UserData`, Firestore o nei backup.
Se lo storage non è scrivibile, il tema scelto resta applicato per la sessione e la UI comunica il limite.

**MUST:** i token critici del tema duplicati nel CSS di bootstrap `public/appearance.css` devono restare coerenti con i corrispondenti token runtime in `src/styles/tokens.css`, sia per dark sia per light e per la preferenza di sistema. Quando cambia uno dei due file, verificare anche l'altro: sfondo, superfici, testo, colori delle azioni, bordi e `color-scheme` devono restare coerenti fra bootstrap e app montata. La splash di caricamento è anch'essa theme-aware e deve mantenere piena continuità cromatica con il tema risolto.

## Tipografia

La scala tipografica è definita **unicamente** in `src/styles/tokens.css`. **MUST:** usare `--font-size-body` per testo normale, `--font-size-secondary` per testo secondario, `--font-size-meta`/`--font-size-micro` per metadati e badge, e `--font-size-control`, `--font-size-section`, `--font-size-page` per titoli nella corretta gerarchia. Dati numerici e timer usano soltanto i token display/timer dedicati. Il marchio nella schermata iniziale e nel dialogo guest usa `--font-size-brand-title`, peso 800, adattato alla larghezza senza spezzare il nome; non si applica a normali titoli di pagina.

- **MUST:** una stessa funzione visiva mantiene lo stesso token fra pagine: titoli di riga/card = `--font-size-control`, descrizioni = `--font-size-body`, metadati = `--font-size-meta`/`--font-size-secondary`. Non introdurre `fontSize` numerici inline o dimensioni arbitrarie; la misura di 16 px per input/select/textarea iOS è un'eccezione intenzionale descritta nella sezione accessibilità.
- **MUST:** nessun testo informativo ordinario scende sotto 12 px; i token display non sostituiscono il testo discorsivo.
- **SHOULD:** preferire classi/selector semantici e token, senza creare nuove misure per replicare una singola schermata.

## Layout, controlli e accessibilità

- **MUST:** controlli principali e navigazione con area di tocco almeno 44×44 px; mantenere il rispetto delle safe area e uno spazio in fondo ai contenuti sopra la barra fissa.
- **MUST:** la schermata di accesso ha un unico scorrimento verticale sull'overlay (inclusi tastiera mobile, zoom e registrazione), senza tagliare il titolo o annidare scroll nella card. Il titolo TheLogBook e la card mantengono le stesse posizioni iniziali passando tra accesso e registrazione; l'overlay dedicato ancora il contenuto in alto, nel rispetto della safe area. Il selettore Accedi/Registrati indica la modalità senza competere cromaticamente con l'azione primaria; la modalità senza account rimane un'azione secondaria evidente con la nota sui dati locali **all'interno dello stesso pulsante**, leggibile e associata anche per le tecnologie assistive. Le etichette dei campi rimangono visibili durante la digitazione.
- **MUST:** la PWA non deve bloccare una singola orientazione dello schermo salvo una necessità essenziale documentata e testata; il manifest corrente lascia l'orientazione al dispositivo/utente.
- **MUST:** input, select e textarea a `font-size: 16px !important` dove applicabile per evitare lo zoom automatico di iOS Safari.
- **MUST:** usare nomi accessibili, stato e focus visibile per tab, menu, dialoghi, mappe interattive e pulsanti a icona. `SubNav<T>` fornisce il pattern condiviso dei tab.
- **MUST:** il dettaglio dello Storico Dati acquisisce e trattiene il focus, chiude con Esc e restituisce il focus al comando di origine ancora presente. Blocca lo scroll sottostante e mantiene tutte le azioni sopra navigazione fissa e indicatori di stato; il contenuto lungo scorre dentro la scheda senza nascondere chiusura e modifica.
- **MUST:** layout, overflow orizzontale, indicatori di bordo e stile base di `SubNav<T>` vivono esclusivamente in `src/styles/sub-nav.css`; i CSS delle singole sezioni non devono ridefinire `.sub-nav*`. Questo mantiene identici scroll e comportamento fra Allenamento, Nutrizione, Dati e future sezioni.
- **NOTE:** `@axe-core/playwright` protegge automaticamente stati rappresentativi e un progetto WebKit/Mobile Safari mirato, ma non sostituisce verifica manuale di tastiera, focus, screen reader e comportamento iOS reale.
- **SHOULD:** usare classi e token per gli stili statici; lasciare inline solo valori realmente dinamici o codice legacy non ancora migrato. Preferire `rem` per le dimensioni che devono seguire le preferenze di carattere; il valore di 16 px degli input è un'eccezione intenzionale.
- **SHOULD:** applicare `min-width: 0` ai figli di layout flex/grid soggetti a overflow e controllare le viewport da 320 px in su.
- **MUST:** testo rivolto all'utente in sentence case italiano, salvo sigle, nomi propri, marchi e il wordmark maiuscolo della splash di caricamento. Icone UI `lucide-react` di norma da 20 o 24 px.

## Stato React, dialoghi e schede mantenute vive

- **MUST:** dialoghi tramite `GlobalDialog`/`useDialogStore`, senza `window.alert`/`window.confirm`; preferire superfici inline/full-screen per editor mobili complessi.
- **MUST:** i selettori Zustand non creano nuove referenze a ogni render. Nelle schede mantenute vive sotto `Suspense`, preservare `style={{ display: ... }}`; l'attributo HTML `hidden` richiede una migrazione esplicitamente testata.
- **MUST:** recovery e render React non mutano lo store globale. `useRef(initialValue)` non è lazy initialization: preservare owner/session fencing e commit React per bozze device-critical.

## PWA, Service Worker e icone

- `vite-plugin-pwa` usa manifest e service worker alla radice `/`.
- La sorgente vettoriale approvata `assets/brand/thelogbook-icon-master.svg` è canonica; `scripts/resize_icons.mjs` pubblica la copia scalabile `public/icon.svg` e genera direttamente dal master favicon, Apple touch, PNG PWA, variante maskable e card social PNG lossless. Quando cambia l'artwork, i riferimenti HTML/manifest devono cambiare revisione per invalidare le cache degli icon consumer.
- Il manifest deve mantenere gli asset PNG standard 192×192 e 512×512 richiesti per la compatibilità/installabilità, la copia SVG scalabile `icon.svg` con `sizes: any` e il dedicato `icon-maskable-512.png` per `purpose: maskable`; evitare duplicati semantici oltre queste varianti necessarie.
- **MUST:** una modifica all'icon pipeline va verificata attraverso build/gate, non solo guardando il file sorgente.
- **MUST:** il reload/update della PWA rispetta il reload barrier di persistenza prima di applicare una nuova versione.

## Verifica

- **MUST:** durante i refactor dei token, controllare la sintassi CSS e che ogni custom property utilizzata sia definita o abbia un fallback deliberato.
- **VERIFY:** testare light/dark e preferenza di sistema, caricamento iniziale senza flash, cambio di tema e indisponibilità dello storage; confrontare i token critici di `public/appearance.css` e `src/styles/tokens.css` dopo ogni modifica alla palette.
- **VERIFY:** controllare navigazione, timer sticky, report e mappa muscolare su viewport strette e desktop. Playwright WebKit è una verifica preventiva; la PWA installata su iPhone richiede accettazione reale sul dispositivo.
