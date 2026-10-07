# Design System — LogBook

> Stato: normativo | Ultima verifica: 2026-09-21 | File verificati: `src/styles/global.css`, `src/styles/tokens.css`, `public/appearance.js`, `public/appearance.css`, `index.html`

## Tema adattivo

La presentazione usa superfici, controlli e navigazione ispirati alle app iPhone, conservando un layout leggibile su schermi piccoli e desktop. `src/styles/global.css` importa i moduli `tokens.css`, `base.css`, `components.css`, `utilities.css`, `context-menu.css` e `ui-surfaces.css`. Le sezioni possono importare il proprio CSS.

`tokens.css` definisce i temi dark e light. Usare token semantici, non colori di testo fissati per il solo tema scuro:

- Superfici e testo: `--bg-color`, `--surface-color`, `--surface-light`, `--text-main`, `--text-muted`, `--glass-border`.
- Azioni e relativi colori leggibili: `--primary-color`/`--on-primary`, `--accent-color`/`--on-accent`, `--warning-color`/`--on-warning`, `--success-color`/`--on-success`, `--danger-color`/`--on-danger`.
- Grafici e mappa: `--chart-grid`, `--muscle-base`, `--muscle-outline`, `--muscle-active`, `--muscle-recent`, `--muscle-pain`.

La scelta `system | light | dark` è una preferenza del dispositivo salvata best-effort nella sola chiave `logbook:appearance:v1`. `index.html` carica `public/appearance.js` e `public/appearance.css` prima del bundle React: lo script imposta il tema e il CSS colora la pagina già al primo disegno. La splash di caricamento resta fissa su sfondo nero con la scritta bianca “Caricamento” e bloom ciano pulsante. In tema scuro la mascotte del cuoco in attesa resta bianca su sfondo nero; in tema chiaro viene invertita esclusivamente l'immagine della mascotte, con sfondo bianco e corpo nero, senza modificare struttura, testo o bloom. Il markup bootstrap di `index.html` e gli stati React bloccanti/lazy usano le stesse classi `brand-loading-screen*` definite in `public/appearance.css`; il componente React canonico è `src/components/UI/BrandLoadingScreen.tsx`. La variante `content` mantiene esattamente proporzioni, spaziatura, testo e bloom della variante fullscreen e riduce uniformemente l'intero gruppo, centrandolo nell'area utile sopra la bottom navigation; non ridimensionare separatamente mascotte o testo. Entrambe le varianti sono overlay fissi e non scrollabili: durante la loro presenza il documento non deve poter scorrere, mentre la variante `content` lascia accessibile la bottom navigation. `useAppearanceStore` ascolta le variazioni del sistema e delle altre schede. **MUST:** non mettere questa scelta in `UserData`, Firestore o nei backup. Se lo storage non è scrivibile, il tema scelto resta applicato per la sessione e la UI comunica il limite.

**MUST:** i token critici del tema duplicati nel CSS di bootstrap `public/appearance.css` devono restare coerenti con i corrispondenti token runtime in `src/styles/tokens.css`, sia per dark sia per light e per la preferenza di sistema. Quando cambia uno dei due file, verificare anche l'altro: sfondo, superfici, testo, colori delle azioni, bordi e `color-scheme` devono restare coerenti fra bootstrap e app montata, fatta salva la splash branding nera deliberatamente indipendente dal tema.

## Tipografia

La tipografia applicativa usa una scala semantica unica definita in `src/styles/tokens.css`. **MUST:** testo normale 15 px (`--font-size-body`), secondario 14 px (`--font-size-secondary`), metadati compatti 13 px (`--font-size-meta`), micro-label/badge 12 px (`--font-size-micro`), titoli di riga/controlli 16 px (`--font-size-control`), titoli sezione 18 px (`--font-size-section`) e titoli pagina 22 px (`--font-size-page`). Valori numerici in forte evidenza e timer possono usare soltanto i token display dedicati da 20/24/28/32/36 px.

- **MUST:** evitare dimensioni tipografiche arbitrarie in CSS e `fontSize` numerici inline; usare i token canonici. L'unica eccezione intenzionale resta `16px` sugli input/select/textarea per la difesa dallo zoom iOS.
- **MUST:** una stessa funzione visiva deve mantenere la stessa dimensione fra pagine: i nomi principali delle righe/card usano 16 px, il testo descrittivo 15 px e i metadati 13–14 px secondo densità.
- **MUST:** nessun testo informativo ordinario scende sotto 12 px. Dimensioni display non vanno usate per testo discorsivo.
- **SHOULD:** preferire classi/selector semantici e token; non introdurre nuovi valori solo per replicare una singola schermata.

## Layout, controlli e accessibilità

- **MUST:** controlli principali e navigazione con area di tocco almeno 44×44 px; mantenere il rispetto delle safe area e uno spazio in fondo ai contenuti sopra la barra fissa.
- **MUST:** la PWA non deve bloccare una singola orientazione dello schermo salvo una necessità essenziale documentata e testata; il manifest corrente lascia l'orientazione al dispositivo/utente.
- **MUST:** input, select e textarea a `font-size: 16px !important` dove applicabile per evitare lo zoom automatico di iOS Safari.
- **MUST:** usare nomi accessibili, stato e focus visibile per tab, menu, dialoghi, mappe interattive e pulsanti a icona. `SubNav<T>` fornisce il pattern condiviso dei tab.
- **MUST:** layout, overflow orizzontale, indicatori di bordo e stile base di `SubNav<T>` vivono esclusivamente in `src/styles/sub-nav.css`; i CSS delle singole sezioni non devono ridefinire `.sub-nav*`. Questo mantiene identici scroll e comportamento fra Allenamento, Nutrizione, Dati e future sezioni.
- **NOTE:** `@axe-core/playwright` protegge automaticamente stati rappresentativi e un progetto WebKit/Mobile Safari mirato, ma non sostituisce verifica manuale di tastiera, focus, screen reader e comportamento iOS reale.
- **SHOULD:** usare classi e token per gli stili statici; lasciare inline solo valori realmente dinamici o codice legacy non ancora migrato. Preferire `rem` per le dimensioni che devono seguire le preferenze di carattere; il valore di 16 px degli input è un'eccezione intenzionale.
- **SHOULD:** applicare `min-width: 0` ai figli di layout flex/grid soggetti a overflow e controllare le viewport da 320 px in su.
- **MUST:** testo rivolto all'utente in sentence case italiano, salvo sigle, nomi propri e marchi. Icone UI `lucide-react` di norma da 20 o 24 px.

## Verifica

- **MUST:** durante i refactor dei token, controllare la sintassi CSS e che ogni custom property utilizzata sia definita o abbia un fallback deliberato.
- **VERIFY:** testare light/dark e preferenza di sistema, caricamento iniziale senza flash, cambio di tema e indisponibilità dello storage; confrontare i token critici di `public/appearance.css` e `src/styles/tokens.css` dopo ogni modifica alla palette.
- **VERIFY:** controllare navigazione, timer sticky, report e mappa muscolare su viewport strette e desktop. Playwright WebKit è una verifica preventiva; la PWA installata su iPhone richiede accettazione reale sul dispositivo.
