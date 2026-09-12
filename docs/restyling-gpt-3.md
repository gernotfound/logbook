# Restyling GPT-3 — piano di implementazione

Data: 12 settembre 2026  
Baseline: `a4f8b1d1b593d15659822ff08a3f89f41c9f3a1f` (`main`)  
Branch: `restyling-gpt-3`  
Stato: **approvato dall'utente il 12 settembre 2026**

## Obiettivo

Portare LogBook da un'interfaccia dark funzionale ma frammentata a un design system moderno, coerente e scalabile, senza modificare il modello dati o la business logic. L'upgrade deve essere mobile-first, rapido durante l'allenamento e sostenibile per una PWA destinata a migliaia di utenti.

## Vincoli non negoziabili

1. Background principale nero reale (`#000000`) in app, cold start e PWA theme color.
2. Timer di recupero sticky in alto nella sessione attiva.
3. Tre controlli timer sempre immediatamente disponibili: play/pausa, reset, stop.
4. Touch target principali ≥44×44 px.
5. Nessuna modifica estetica deve alterare persistenza, sincronizzazione, calcoli workout/nutrizione o schema dati.
6. CSS nativo; niente Tailwind o nuove dipendenze UI.
7. Ridurre al minimo i push per non consumare build Vercel Hobby: obiettivo un singolo push consolidato.

## Architettura

- `src/styles/global.css`: compatibility layer esistente, mantenuto per ridurre il rischio di regressioni.
- `src/styles/tokens.css`: nuovo livello di token semantici con alias legacy.
- `src/styles/restyling.css`: primitive e componenti del tema Midnight Performance.
- Componenti React migrati gradualmente da `style={{...}}` statici a classi semantiche.

La migrazione a strati evita un big-bang refactor dei CSS e permette alle schermate non ancora convertite di beneficiare immediatamente dei nuovi token e delle primitive globali.

## Aree incluse

- cold start PWA e loading state;
- app shell e feedback di sync;
- bottom navigation;
- Home dashboard e bento layout;
- workout hero, nutrizione, biometria, recupero;
- primitive globali di card, section, button, input, tab e segmented control;
- sessione di allenamento, timer sticky, durata globale, azioni finali;
- responsive mobile e `prefers-reduced-motion`;
- documentazione del design system.

Le aree Nutrizione, Dati, Settings e i form non vengono riscritte integralmente in questo lotto: ricevono il nuovo linguaggio visuale tramite token e primitive condivise. Questo limita il rischio e crea una base coerente per migrazioni successive.

## Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Regressione del timer | Logica invariata; modifica limitata al markup/iconografia e CSS; mantenuti gli stessi handler e lo stesso storage. |
| CSS globale rompe schermate secondarie | `global.css` non viene eliminato; nuovi stili sono un layer successivo e conservano gli alias legacy. |
| Home troppo densa su telefoni stretti | Bento a due colonne fino a 340 px, poi fallback a colonna singola. |
| Effetti visuali costosi | Blur rimosso dalle card ordinarie; background opachi e shadow contenute. |
| Incoerenza futura | Token semantici e documentazione normativa aggiornati nello stesso commit. |
| Consumo deploy Vercel | Creazione di blob/tree/commit Git senza aggiornare branch; branch pubblicato soltanto dopo consolidamento. |

## Verifica obbligatoria

Dopo la pubblicazione del singolo commit sul branch:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:e2e`
5. verifica preview Vercel e build log
6. controllo manuale responsive almeno su viewport stretta e standard mobile
7. verifica specifica timer: sticky, 3 pulsanti, start/pause/reset/stop

Se un check fallisce, correggere con il minor numero possibile di push aggiuntivi e documentare il motivo.

## Rollback

Il restyling non introduce migrazioni dati. Il rollback è quindi un normale revert del commit del branch. `global.css` rimane disponibile come compatibility layer, riducendo ulteriormente il costo di rollback.
