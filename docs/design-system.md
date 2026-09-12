# Design System — LogBook

> Stato: normativo | Revisione UI: 2026-09-12

## Principio: OLED Athletic Dark

LogBook usa un'interfaccia **dark OLED-first** pensata per sessioni prolungate in palestra, spesso con schermo acceso e Wake Lock attivo.

Il canvas principale è **nero puro `#000000`** e non deve essere sostituito da un grigio scuro globale. Le superfici più chiare servono esclusivamente a creare gerarchia locale tra contenuto, controlli e overlay.

Obiettivi del linguaggio visivo:

- contrasto elevato senza abbagliare in ambienti scuri;
- informazioni numeriche leggibili a colpo d'occhio;
- azioni principali immediatamente riconoscibili;
- pochi effetti GPU costosi durante sessioni lunghe;
- gerarchia coerente fra Home, Allenamento, Nutrizione, Dati e Impostazioni;
- componenti riusabili e modificabili tramite token centralizzati.

## Architettura CSS

Lo styling resta **CSS nativo**. Tailwind non è ammesso.

Ordine di caricamento:

1. `src/styles/global.css` — compatibilità e stili storici ancora in migrazione;
2. `src/styles/tokens.css` — design tokens e alias legacy;
3. `src/styles/modern.css` — componenti, layout e override moderni.

Questa stratificazione è intenzionale: consente una migrazione progressiva senza riscrivere contemporaneamente tutte le schermate e riduce il rischio di regressioni.

### Regola di evoluzione

- Nuovi valori visuali condivisi MUST nascere come token in `tokens.css`.
- Nuove primitive riusabili SHOULD essere definite in `modern.css`.
- `global.css` è compatibility baseline: evitare di aggiungervi nuovi pattern se esiste un equivalente moderno.
- Stili inline statici SHOULD essere migrati verso classi semantiche quando il componente viene modificato.
- Stili inline sono ammessi per valori realmente dinamici calcolati a runtime.

## Token principali

### Canvas e superfici

- `--bg-color: #000000` — canvas OLED; **MUST rimanere nero puro**.
- `--surface-color` — superficie base elevata.
- `--surface-light` — controlli e blocchi interattivi.
- `--surface-raised` — stato attivo / elemento selezionato.
- `--surface-interactive` — pulsanti neutri.

### Primary

- `--primary-color: #00e5ff`
- `--primary-hover`
- `--primary-soft`
- `--primary-soft-strong`
- `--on-primary` — testo/icone da usare sopra il primary pieno.

**MUST:** su sfondo cyan pieno usare `--on-primary`, non bianco. Il primary è un colore d'azione e di stato, non uno sfondo decorativo generalizzato.

### Testo

- `--text-main` — informazione primaria.
- `--text-muted` — informazione secondaria.
- `--text-subtle` — metadata e hint non critici.

### Feedback semantico

- `--success-color`
- `--warning-color`
- `--danger-color`

I colori semantici non vanno usati come accenti estetici generici.

### Spacing e radius

Usare `--space-1` … `--space-8` e `--radius-xs` … `--radius-xl` / `--radius-pill` invece di introdurre valori ricorrenti arbitrari.

## Tipografia

Font stack: Inter se disponibile, quindi system UI.

- Titoli: peso forte, tracking leggermente negativo.
- Metriche: numeri tabulari quando cambiano frequentemente.
- Corpo: alta leggibilità e line-height generosa.
- Input/select/textarea: `font-size: 16px !important` per prevenire zoom iOS.

Le utility `.text-xs`, `.text-sm`, `.text-md`, `.text-base`, `.text-lg`, `.text-xl` restano valide.

## Componenti

### Card / surface

Le card sono riservate a contenuti che beneficiano realmente di un confine visivo: widget dashboard, grafici, dialog, elementi riassuntivi.

Le sezioni lunghe di form o editor usano preferibilmente `.section-divider` / `.section-divider-last`, evitando il pattern "box dentro box".

`backdrop-filter` non va applicato alle card normali: il blur è riservato a elementi flottanti o overlay.

### Pulsanti

Gerarchia:

1. `.btn-primary` — azione principale;
2. `.btn-secondary` — azione secondaria;
3. `.btn-danger` — distruttiva;
4. `.btn-success` — conferma positiva quando semanticamente necessario;
5. `.btn-icon` — azione iconica.

Touch target principale: almeno 44×44 px.

### Form

Input, select e textarea condividono altezza, radius, superficie e focus ring. Gli errori devono essere visibili senza affidarsi solo al colore.

### Navigazione principale

La bottom navigation è flottante sopra il canvas nero. L'elemento attivo usa un'indicazione primaria discreta; le cinque destinazioni principali restano sempre accessibili.

### Sotto-navigazione

`.sub-nav` + `.sub-nav-btn` rappresentano il pattern standard per i tab interni di Allenamento, Nutrizione e Dati.

## Invariante workout timer

`WorkoutTimer.tsx` è un controllo operativo, non decorativo.

Durante una sessione attiva:

- **MUST:** il timer restare sticky nella parte alta dello schermo;
- **MUST:** restare visibili contemporaneamente tre slot di controllo;
- slot 1: Play oppure Pausa, in base allo stato;
- slot 2: Riavvia;
- slot 3: Stop;
- **MUST:** non spostare questi comandi in menu, gesture o pannelli secondari;
- **MUST:** preservare persistenza device-local e ricalcolo tramite `Date.now()` al ritorno dal background;
- **MUST:** preservare il Wake Lock della sessione attiva;
- icone: `lucide-react`, non emoji.

## Motion

Motion breve e informativa:

- feedback pressione: ~120 ms;
- transizioni di stato: ~180 ms;
- ingresso vista: ~260 ms massimo.

`prefers-reduced-motion: reduce` deve ridurre drasticamente transizioni e animazioni.

## Accessibilità e mobile

- touch target ≥44×44 px;
- focus visibile per tastiera/switch input;
- `min-width: 0` nei figli flex soggetti a overflow;
- safe-area iOS rispettata per timer, banner e bottom navigation;
- nessuno scroll orizzontale involontario a 320 px;
- contrasto verificato soprattutto per primary pieno, testi muted e stati semantici;
- non affidarsi soltanto al colore per indicare stato o errore.

Viewport di verifica minime: 320, 375, 390/430 e 600 px.

## Iconografia

Usare `lucide-react`, di norma 20–24 px. Le icone devono accompagnare una gerarchia chiara e non sostituire label necessarie all'accessibilità.

## Testo UI

Sentence case italiano.

- ❌ `Nuova Misurazione Corporea`
- ✅ `Nuova misurazione corporea`

Solo nomi propri, sigle e marchi mantengono maiuscole interne.
