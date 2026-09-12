# Design System — LogBook

> Stato: normativo | Ultima verifica: 2026-09-12 | Tema: **Midnight Performance**

LogBook usa un'interfaccia dark, mobile-first e ottimizzata per l'uso prolungato durante l'allenamento. Il design deve privilegiare leggibilità, velocità di interazione, batteria/GPU e coerenza rispetto agli effetti decorativi.

## Architettura degli stili

Il progetto usa esclusivamente CSS nativo. **Non introdurre Tailwind, CSS-in-JS o una seconda libreria di componenti senza una decisione architetturale esplicita.**

L'ordine di caricamento è:

1. `src/styles/global.css` — compatibility layer storico: reset, utility e regole ancora usate dalle schermate non migrate.
2. `src/styles/tokens.css` — fonte dei token semantici e alias compatibili con i nomi legacy.
3. `src/styles/restyling.css` — primitive, layout e componenti del design system corrente.

Questa struttura consente una migrazione incrementale: una schermata può essere convertita a classi semantiche senza richiedere una riscrittura simultanea dell'intera PWA.

### Regola sugli inline style

- **MUST:** layout, spacing, tipografia, colori statici, bordi e shadow vanno in CSS.
- **MAY:** `style={...}` solo per valori realmente dinamici derivati dallo stato, ad esempio larghezza di una progress bar, custom property di un grafico o coordinate calcolate.
- **MUST:** non duplicare in JSX valori già rappresentati da un token o da una classe del design system.

## Invariante OLED / dark mode

Lo sfondo dell'app è **nero reale**:

- `--color-bg-canvas: #000000`
- `--bg-color` è un alias di `--color-bg-canvas`
- `html`, `body` e `#root` devono restare neri
- `theme-color` della PWA resta `#000000`

Le superfici rialzate usano neri leggermente più chiari per creare gerarchia senza trasformare l'interfaccia in una UI grigio-blu. Evitare grandi superfici chiare, specialmente nella sessione di allenamento.

## Token semantici principali

### Superfici

- `--color-bg-canvas`: background assoluto
- `--color-bg-surface`: sezione/card discreta
- `--color-bg-elevated`: card prioritaria
- `--color-bg-interactive`: controllo inattivo
- `--color-bg-hover`: hover desktop

### Testo

- `--color-text-primary`: contenuto ad alta priorità
- `--color-text-secondary`: testo descrittivo
- `--color-text-tertiary`: metadata e label secondarie

### Colori funzionali

- `--color-accent`: azione/selection primaria
- `--color-success`: esito positivo o completamento
- `--color-warning`: attenzione e timer di recupero attivo
- `--color-danger`: distruttivo, dolore, errore

Usare i colori funzionali per comunicare stato, non come decorazione arbitraria.

### Spacing, radius e motion

Usare i token `--space-*`, `--radius-*`, `--duration-*` e `--ease-out` invece di introdurre nuovi valori quasi equivalenti.

## Primitive UI

Le primitive condivise includono:

- `.card`
- `.section-divider`
- `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-success`, `.btn-danger`
- `.btn-small`, `.btn-icon`
- `.sub-nav`, `.sub-nav-btn`
- `.segmented-control`, `.segmented-control__item`
- `.badge`, `.toggle-btn`
- input/select/textarea globali
- `.empty-state`

Quando una nuova schermata necessita di una variante, preferire una classe semanticamente nominata che componga queste primitive invece di copiare proprietà CSS nel componente React.

## Tipografia

- Preferire tag semantici (`h1`–`h4`) per la gerarchia.
- I numeri temporali e le durate usano font monospaziato di sistema e `font-variant-numeric: tabular-nums`.
- Input, select e textarea mantengono `font-size: 16px !important` per evitare lo zoom automatico di iOS Safari.
- Testi UI in sentence case italiano.

## Navigazione

La bottom navigation mantiene cinque destinazioni principali:

**Home · Allenamento · Nutrizione · Dati · Impostazioni**

Il tab attivo deve essere immediatamente riconoscibile senza dipendere soltanto dal movimento o dal glow. Safe area e touch target restano obbligatori.

## Home dashboard

La Home usa una griglia bento a due colonne dove lo spazio lo consente:

- header KPI compatto;
- workout hero a larghezza piena;
- nutrizione a larghezza piena;
- biometria e recupero affiancati;
- analytics sotto i contenuti operativi.

Sotto ~340 px è consentito il fallback a colonna singola. Evitare di forzare una colonna singola su tutti gli smartphone: aumenta inutilmente la lunghezza della schermata.

## Sessione di allenamento — invarianti UX

La sessione attiva è la superficie più importante della PWA.

- **MUST:** il timer di recupero resta sticky in alto.
- **MUST:** sono sempre presenti **tre controlli**: play/pausa, reset, stop.
- **MUST:** ciascun controllo mantiene un touch target di almeno 44×44 px; target nominale 48×48 px quando lo spazio lo consente.
- **MUST:** il timer resta leggibile su background nero e usa cifre tabulari.
- **MUST:** un restyling non modifica la logica di persistenza o il calcolo temporale solo per ragioni estetiche.
- **SHOULD:** azioni distruttive e completamento sessione devono essere visivamente separate.

## Performance visuale

Il precedente glassmorphism viene usato in modo selettivo.

- Card normali: background opaco/scuro + border + shadow leggera.
- `backdrop-filter`: riservato a overlay/dialog o casi in cui la trasparenza ha valore reale.
- Evitare glow grandi e blur continui su liste lunghe o durante la sessione di allenamento.
- Le animazioni devono essere brevi e funzionali (circa 120–260 ms).
- **MUST:** rispettare `prefers-reduced-motion`.

## Accessibilità mobile

Restano validi i vincoli di `AGENTS.md`:

- touch target principali ≥44×44 px;
- focus `:focus-visible` evidente;
- safe-area iOS;
- nessun editor complesso in `<dialog>` nativo;
- feedback immediato per azioni di salvataggio, aggiunta ed eliminazione;
- contrasto sufficiente anche in ambiente luminoso da palestra.

## Iconografia

Usare `lucide-react` per le azioni dell'interfaccia. Emoji e simboli Unicode possono restare nei contenuti esistenti, ma non sono la scelta predefinita per nuovi pulsanti di controllo.

## Regola di consistenza

Una nuova UI è considerata coerente quando riusa token, primitive e stati del sistema invece di introdurre una nuova grammatica locale. Se una variante ricorre almeno due volte, valutarne la promozione a primitive condivisa.
