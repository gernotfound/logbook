# Implementation plan — restyling-gpt-1

## Obiettivo

Eseguire un restyling strutturale e scalabile della PWA LogBook mantenendo invariata la logica dati, con particolare attenzione a uso mobile prolungato in palestra, accessibilità, performance e consistenza fra schermate.

## Vincoli approvati

- Canvas principale nero puro `#000000` per uso OLED e sessioni con schermo acceso.
- CSS nativo; nessun Tailwind o nuovo framework UI.
- Timer recupero sticky preservato.
- Tre slot timer sempre visibili: Play/Pausa, Riavvia, Stop.
- Wake Lock e persistenza timer invariati.
- Nessuna modifica a schema dati, Firestore, sync o import/export salvo necessità emersa dai test.
- Numero minimo di push Vercel: costruzione dei commit tramite Git Data API e avanzamento del branch solo dopo review del tree.

## Strategia tecnica completata

### Fondazione

1. `tokens.css` come fonte centralizzata di colori, superfici, spacing, radius, shadow, motion e focus.
2. `modern.css` come layer di migrazione dopo `global.css`, evitando una riscrittura big-bang.
3. `product-polish.css` per pattern condivisi e normalizzazione progressiva del legacy.
4. Fogli dedicati a shell/overlay e domini complessi (workout, nutrizione, misurazioni, settings).

### Migrazione prodotto

- Bottom navigation, Home dashboard e bootstrap loader.
- Timer/session header con invariante dei tre controlli.
- Avvio workout, esercizi, righe serie, dropset/isometrie, note e pannelli storico/setup.
- Diario Nutrizione: riepilogo kcal/macro, ricerca, pasti e integratori.
- Dati: editor misurazioni, storico e biometria.
- Impostazioni, Account, export granulare, backup, privacy e diagnostica.
- Login, modalità guest, dialog globali, prompt PWA, reload prompt e consenso legale.
- Iconografia operativa migrata verso `lucide-react` nelle aree toccate.

## Architettura CSS risultante

- `src/styles/global.css` — compatibility baseline
- `src/styles/tokens.css` — token
- `src/styles/modern.css` — primitive condivise
- `src/styles/product-polish.css` — pattern condivisi di prodotto
- `src/styles/shell.css` — shell/PWA feedback
- `src/styles/overlays.css` — dialog/overlay
- `src/styles/workout.css` — sessione attiva
- `src/styles/workout-start.css` — avvio sessione
- `src/styles/nutrition.css` — diario nutrizionale
- `src/styles/measurement.css` — misurazioni corporee
- `src/styles/settings.css` — account/impostazioni

La separazione è intenzionale: token → primitive → composizioni di dominio. Nuovi valori condivisi non devono essere duplicati nei fogli di dominio.

## Rischi e mitigazioni

- **Cascade CSS:** ordine di import esplicito e classi semantiche.
- **Viewport stretti:** breakpoint mirati a 430/390/370/340 px, senza modificare la max-width applicativa.
- **Regressioni timer:** logica di stato/persistenza non modificata; test dedicato ai tre controlli.
- **Regressioni testuali:** mantenuti testi e aria-label utilizzati dalle suite dove fanno parte del contratto UI.
- **Bundle:** nessuna nuova dipendenza; Lucide/Fuse erano già presenti.
- **GPU/batteria:** blur limitato a navigation, overlay e superfici realmente flottanti; card normali senza blur.
- **Logica account/export:** refactor solo presentazionale; callback e flussi originali preservati.

## Verifica obbligatoria

In sequenza, secondo `AGENTS.md`:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:e2e`

In aggiunta:

- Vercel Preview Deployment;
- Snyk / status checks;
- viewport mobile strette;
- Home, sessione attiva, avvio sessione, Nutrizione, Dati, Settings/Auth;
- timer sticky e tre controlli sempre accessibili.

## Rollback

Il lavoro resta isolato su `restyling-gpt-1`. I commit sono esclusivamente presentazionali/documentali/test, senza migrazioni dati: il rollback non richiede trasformazioni di storage o Firestore.
