# Audit UI Controls - LogBook

Data: 12 settembre 2026

Questo documento censisce tutti i tipi di controlli interattivi (bottoni, toggle, menu, tab, ecc.) presenti nell'interfaccia di LogBook e ne definisce il contratto visivo (varianti semantiche). Le informazioni sono dedotte dal file `global.css` e dai componenti base di UI.

## Censimento Controlli e Varianti Semantiche

| Tipo Semantico | Dimensioni/Touch Target | Font | Peso | Colore | Icona | Hover | Active | Focus-Visible | Disabled | Loading | `aria-*` | Comportamento Mobile | Wrapping |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Button Primary** (`.btn.btn-primary`) | Min-height: 44px, Padding: 14px 20px, Width: 100% | 1rem | 600 | Testo: #fff, Bg: gradiente azzurro | Supportata (sx) | - | Scala 0.98, Ombra ridotta | `outline: none`, Ombra azzurra | Opacità 0.4, cursor: not-allowed | (da definire) | Nessuno default | Occupa larghezza intera, touch target ampio | No wrap (`white-space: nowrap`) |
| **Button Secondary** (`.btn.btn-secondary`) | Min-height: 44px, Padding: 14px 20px, Width: 100% | 1rem | 600 | Testo: var(--text-main), Bg: semitrasparente | Supportata (sx) | Bg: rgba(255,255,255,0.12) | Scala 0.98 | `outline: none`, Ombra azzurra | Opacità 0.4 | - | Nessuno default | Occupa larghezza intera | No wrap |
| **Button Danger** (`.btn.btn-danger`) | Min-height: 44px, Padding: 14px 20px, Width: 100% | 1rem | 600 | Testo/Bordo: var(--danger-color), Bg: transp. | Supportata (sx) | - | Scala 0.98 | `outline: none`, Ombra azzurra | Opacità 0.4 | - | Nessuno default | Occupa larghezza intera | No wrap |
| **Button Success** (`.btn.btn-success`) | Min-height: 44px, Padding: 14px 20px, Width: 100% | 1rem | 600 | Testo: #fff, Bg: gradiente verde | Supportata (sx) | - | Scala 0.98 | `outline: none`, Ombra azzurra | Opacità 0.4 | - | Nessuno default | Occupa larghezza intera | No wrap |
| **Button Small** (`.btn.btn-small`) | Min-height: 44px, Padding: 8px 14px, Width: auto | 0.85rem | 600 | Come base (primary, secondary, ecc.) | Supportata | Come base | Scala 0.98 | `outline: none`, Ombra azzurra | Opacità 0.4 | - | Nessuno default | Touch target minimo garantito, inline | No wrap |
| **Button Icon** (`.btn-icon`) | Min-height: 44px, Min-width: 44px, Padding: 6px | 1.2rem | Normal | Testo: inherit, Bg: transparent | Sì (centrata) | Bg: rgba(255,255,255,0.1) | Scala 0.98 | `outline: none`, Ombra azzurra | Opacità 0.4 | - | `aria-label` obbligatoria | Circolare, touch target adeguato | No wrap |
| **Button Link** (`.btn-link`) | Padding 0 | 0.95rem | Normal | Testo: var(--primary-color) | - | Testo: var(--primary-dark) | - | `outline: 2px solid`, offset 2px | - | - | - | Inline, tocca minimo 44px o isolato | Wrap permesso |
| **Accordion Button** (`.accordion-btn`) | Min-height: 44px, Padding: 14px 16px, Width: 100% | 0.95rem | 600 | Testo: var(--text-main), Bg: transparent | Sì | Bg: rgba(255,255,255,0.05) | Bg: rgba(255,255,255,0.08) (expanded) | `outline: 2px solid`, offset -2px | - | - | `aria-expanded` | Occupa larghezza intera | No wrap |
| **Toggle Button** (`.toggle-btn`) | Min-height: 44px, Padding: 6px 12px | 0.85rem | Normal (600 active) | Testo: var(--text-muted) -> var(--primary-color) | Eventuale | Bg: rgba(255,255,255,0.1) | Bg: azzurro chiaro, Bordo azzurro | - | - | - | `aria-pressed` | Inline, compatto | No wrap |
| **Sub Nav / Tab** (`.sub-nav-btn`) | Min-height: 44px, Min-width: 110px, Padding: 10px 16px | 0.9rem | 600 | Testo: var(--text-muted) -> #000 | - | - | Scala 0.98 | `outline: none`, Ombra azzurra | - | - | `aria-current` | Scorrevole orizzontale nativo | No wrap |
| **Bottom Nav Item** (`.nav-item`) | Min-height: 44px, Flex: 1, Padding: 11px 0 | 0.75rem | 600 | Testo: var(--text-muted) -> var(--primary-color) | Sì (top) | - | Scala 0.95 | `outline: 2px solid`, offset 2px | - | - | `aria-current="page"` | Touch target massimo diviso equamente | Wrap limitato |
| **Timer Button** (`.timer-btn`) | 46x46 px | - | - | Testo: var(--text-main) -> colore | Sì (18px) | - | Scala 0.85, Ombra interna | - | - | - | `aria-label` | Circolare, feedback tattile marcato | No wrap |
| **Tracking Card** (`.tracking-card-option`) | Padding: 12px 14px, Flex: 1 | 0.9rem | 500 (700 active) | Testo: var(--text-muted) -> var(--primary-color) | Sì | Bg: rgba(255,255,255,0.06) | Gradiente azzurro | `outline: 2px solid`, offset 2px | - | - | `aria-selected` / radio | Griglia divisa, grandi aree touch | No wrap |
| **Context Menu Item** (`ContextMenu`) | Touch target > 44px (lista) | 0.9rem | 500 | Testo: var(--text-main) / rosso (danger) | Sì | Bg lighter | Bg active | - | - | - | `role="menuitem"` | Bottom sheet / lista sovrapposta | No wrap |
| **Global Dialog Button** | Come `.btn` | 1rem | 600 | Come base | - | - | - | - | - | - | - | Stacked verticale se stretti | No wrap |

## Note Generali e Contratto Visivo
- **Emoji funzionali**: Ogni emoji usata per funzioni di click (es. +, -, edit) deve essere sostituita con icone tratte da `lucide-react` dotate di `aria-hidden="true"` se ridondanti o `aria-label` se isolate.
- **Div/Span interattivi**: Eventuali `div` o `span` con handler `onClick` e `role="button"` non documentati qui dovranno essere migrati ai bottoni semantici descritti in tabella (`.btn`, `.btn-icon`, `.toggle-btn`) per garantire consistenza e accessibilità.
- **Dimensioni Minime iOS**: Tutti gli elementi cliccabili mantengono una dimensione minima tangibile di ~44x44px. Nessun font di input inferiore a 16px.
- **CSS**: Le classi documentate in questa tabella derivano dalle definizioni correnti di `src/styles/global.css`. Tutte le nuove UI introdotte (Crea Esercizio, Allenamento Libero, Auth) adotteranno rigorosamente questi componenti standard, senza inventare nuovi ruoli visivi.
