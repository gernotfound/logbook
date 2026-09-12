# Design System — LogBook

> Stato: normativo | Ultima verifica: 2026-09-09 | File verificati: `src/styles/global.css`

## Tema: Dark Glassmorphism

Il tema è profondo, minimale e governato centralmente da `src/styles/global.css`.

### Variabili CSS principali

**Sfondi:**
- `--bg-color: #000000`
- `--surface-color: #0d0d0d`
- `--surface-light: #1a1a1a`

**Accenti:**
- `--primary-color: #00e5ff`
- `--primary-glow: rgba(0, 229, 255, 0.3)`
- `--accent-color: #cc00ff`

**Feedback:**
- `--danger-color: #ff4d6d`
- `--warning-color: #ffb703`
- `--success-color: #2ecc71`

**Trasparenze in vetro:**
- `--glass-bg: rgba(13, 13, 13, 0.85)`
- `--glass-border: rgba(255, 255, 255, 0.1)`

**Testi:**
- `--text-main: #f0f0f0`
- `--text-muted: #9ba3af`

### Classi e prefissi standard

`.card`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-small`, `.btn-icon`, `.form-group`, `.input-row`, `.spinner`

## Tipografia e dimensioni

- **MUST:** Usare le classi di utilità globali per i testi: `.text-xs`, `.text-sm`, `.text-md`, `.text-base`, `.text-lg`, `.text-xl` (definite in `global.css`).
- **MUST:** Non usare stili inline (`style={{ fontSize: '...' }}`) salvo eccezioni dinamiche imprescindibili.
- **MUST:** Usare `rem` e mai `px` per scalare con le preferenze di accessibilità.
- **SHOULD:** Affidarsi ai tag semantici (`<h1>`, `<h2>`, `<h3>`, `<h4>`) per i titoli.
- **Eccezione:** I campi `<input>`, `<select>` e `<textarea>` devono mantenere `font-size: 16px !important` (già gestito globalmente) per prevenire lo zoom automatico su iOS Safari.

## Stile testuale — Sentence case italiano

**MUST:** Ogni testo rivolto all'utente (label, bottoni, placeholder, alert, titoli) deve rispettare la convenzione italiana del Sentence case.

- ❌ Sbagliato (Title case): "Nuova Misurazione Corporea", "Salva Modifiche Scheda"
- ✅ Corretto: "Nuova misurazione corporea", "Salva modifiche scheda"

Solo la primissima lettera della frase va in maiuscolo. Le parole successive sono minuscole, salvo nomi propri, sigle o marchi.

## Iconografia

`lucide-react` con proporzioni coerenti: di norma `size={24}` o `size={20}`.

## Regola di consistenza

Quando aggiungi un elemento di UI, assicurati che rispetti la densità, il contrasto e il feeling premium del tema dark glassmorphism.

- **MUST:** Prestare massima attenzione alla sintassi CSS (chiusura corretta di tutte le parentesi graffe `}`). Un errore di sintassi silenzioso nel CSS rompe l'intero layout senza far fallire la build.
- **MUST:** Durante un refactoring delle variabili CSS (es. l'estrazione in file di token dedicati), verificare minuziosamente che TUTTE le variabili originali (es. `--primary-dark`) siano migrate e caricate correttamente per evitare fallback del browser.
