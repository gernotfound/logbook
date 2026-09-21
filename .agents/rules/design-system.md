# Design System — LogBook

> Stato: normativo | Ultima verifica: 2026-09-21 | File verificati: `src/styles/global.css`, `src/styles/tokens.css`, `public/appearance.js`

## Tema adattivo

La presentazione usa superfici, controlli e navigazione ispirati alle app iPhone, conservando un layout leggibile su schermi piccoli e desktop. `src/styles/global.css` importa i moduli `tokens.css`, `base.css`, `components.css`, `utilities.css`, `context-menu.css` e `ui-surfaces.css`. Le sezioni possono importare il proprio CSS.

`tokens.css` definisce i temi dark e light. Usare token semantici, non colori di testo fissati per il solo tema scuro:

- Superfici e testo: `--bg-color`, `--surface-color`, `--surface-light`, `--text-main`, `--text-muted`, `--glass-border`.
- Azioni e relativi colori leggibili: `--primary-color`/`--on-primary`, `--accent-color`/`--on-accent`, `--warning-color`/`--on-warning`, `--success-color`/`--on-success`, `--danger-color`/`--on-danger`.
- Grafici e mappa: `--chart-grid`, `--muscle-base`, `--muscle-outline`, `--muscle-active`, `--muscle-fatigue`, `--muscle-pain`.

La scelta `system | light | dark` è una preferenza del dispositivo salvata best-effort nella sola chiave `logbook:appearance:v1`. `public/appearance.js` applica il tema prima che React monti l'app; `useAppearanceStore` ascolta le variazioni del sistema e delle altre schede. **MUST:** non mettere questa scelta in `UserData`, Firestore o nei backup. Se lo storage non è scrivibile, il tema scelto resta applicato per la sessione e la UI comunica il limite.

## Layout, controlli e accessibilità

- **MUST:** controlli principali e navigazione con area di tocco almeno 44×44 px; mantenere il rispetto delle safe area e uno spazio in fondo ai contenuti sopra la barra fissa.
- **MUST:** input, select e textarea a `font-size: 16px !important` dove applicabile per evitare lo zoom automatico di iOS Safari.
- **MUST:** usare nomi accessibili, stato e focus visibile per tab, menu, dialoghi, mappe interattive e pulsanti a icona. `SubNav<T>` fornisce il pattern condiviso dei tab.
- **SHOULD:** usare classi e token per gli stili statici; lasciare inline solo valori realmente dinamici o codice legacy non ancora migrato. Preferire `rem` per le dimensioni che devono seguire le preferenze di carattere; il valore di 16 px degli input è un'eccezione intenzionale.
- **SHOULD:** applicare `min-width: 0` ai figli di layout flex/grid soggetti a overflow e controllare le viewport da 320 px in su.
- **MUST:** testo rivolto all'utente in sentence case italiano, salvo sigle, nomi propri e marchi. Icone UI `lucide-react` di norma da 20 o 24 px.

## Verifica

- **MUST:** durante i refactor dei token, controllare la sintassi CSS e che ogni custom property utilizzata sia definita o abbia un fallback deliberato.
- **VERIFY:** testare light/dark e preferenza di sistema, caricamento iniziale senza flash, cambio di tema e indisponibilità dello storage.
- **VERIFY:** controllare navigazione, timer sticky, report e mappa muscolare su viewport strette e desktop. Playwright WebKit è una verifica preventiva; la PWA installata su iPhone richiede accettazione reale sul dispositivo.
