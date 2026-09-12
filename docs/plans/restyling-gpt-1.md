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
- Numero minimo di push Vercel: costruzione di un unico commit Git tramite Git Data API e un solo avanzamento del branch quando possibile.

## Strategia tecnica

1. Introdurre `tokens.css` come fonte centralizzata di colori, superfici, spacing, radius, shadow, motion e focus.
2. Introdurre `modern.css` come layer di migrazione dopo `global.css` per evitare una riscrittura big-bang del foglio storico.
3. Migrare i componenti ad alta frequenza: bottom navigation, timer/session header, Home dashboard e bootstrap loader.
4. Applicare primitive globali a pulsanti, input, card, sub-nav, feedback e focus state così che Nutrizione, Dati e Impostazioni ricevano l'upgrade senza duplicazione.
5. Aggiornare la documentazione del design system con invarianti e percorso di migrazione.

## File principali

- `src/styles/tokens.css` (nuovo)
- `src/styles/modern.css` (nuovo)
- `src/main.tsx`
- `src/components/UI/BottomNav.tsx`
- `src/components/Training/WorkoutTimer.tsx`
- `src/components/Training/SessionHeader.tsx`
- `src/components/Home/HomeView.tsx`
- `src/components/Home/widgets/HeaderDashboard.tsx`
- `index.html`
- `docs/design-system.md`

## Rischi

- Cascade CSS: mitigato caricando il layer moderno per ultimo e mantenendo selettori mirati.
- Viewport 320 px: mitigato con media query specifica per timer e dashboard.
- Regressioni timer: logica stato/persistenza non modificata; cambia solo markup presentazionale e iconografia.
- Bundle: nessuna nuova dipendenza; Lucide è già installato.
- GPU/batteria: blur limitato a navigazione flottante e timer sticky; card normali senza backdrop-filter.

## Verifica richiesta

In sequenza, secondo `AGENTS.md`:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:e2e`

In aggiunta: controllo preview Vercel e verifica manuale delle aree Home / Sessione / nav / viewport strette.

## Rollback

Il lavoro è isolato sul branch `restyling-gpt-1`. Il singolo commit può essere revertito integralmente senza migrazioni dati. I nuovi fogli CSS sono additive layers, quindi il rollback non richiede trasformazioni di storage.
