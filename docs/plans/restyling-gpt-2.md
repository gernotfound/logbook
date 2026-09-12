# Restyling GPT-2 — piano e criteri di accettazione

Data: 2026-09-12  
Branch: `restyling-gpt-2`  
Base prevista: `main` @ `a4f8b1d1b593d15659822ff08a3f89f41c9f3a1f`

## Obiettivo

Portare LogBook da una UI funzionale ma eterogenea a un sistema visivo mobile-first coerente, scalabile e adatto all'uso prolungato durante l'allenamento, senza modificare modello dati, sincronizzazione, persistenza o semantica dei flussi principali.

## Vincoli approvati

- Canvas e dark mode con background OLED nero `#000`.
- Timer recupero della sessione sempre visibile in alto durante lo scroll.
- Tre controlli timer sempre presenti: Avvia/Pausa, Riavvia, Ferma.
- Nessun Tailwind o UI framework aggiuntivo.
- Preservare i selettori E2E esistenti per `sub-nav-btn` e `timer-btn.*`.
- Ridurre al minimo push/deploy Vercel: un unico commit/ref update per la feature, salvo correzioni necessarie dopo CI/build.

## Interventi

### Fondazioni

- Aggiunta `tokens.css` con palette, spacing, radius, motion, surface e semantic colors.
- Aggiunta `design-system.css` come layer trasversale compatibile con il CSS legacy.
- Aggiunta `workout.css` per isolare lo styling ad alta densità della sessione.
- Caricamento esplicito dopo `global.css` in `main.tsx`.

### App shell e navigazione

- Loading, modalità guest, pannelli keep-alive e feedback di sincronizzazione migrati a classi semantiche senza cambiare logica o storage.
- Bottom navigation convertita da definizioni inline duplicate a classi del design system.
- Stato attivo più riconoscibile tramite surface, cyan e indicatore inferiore.
- Conflict dot nutrizione mantenuto ma standardizzato.
- Introduzione di `SectionTabs` per eliminare duplicazione nei sotto-menu Allenamento/Nutrizione/Dati.

### Home

- Header trasformato in area brand + KPI compatti.
- Surface workout/nutrizione riprogettate con gerarchia più forte.
- Biometria/recovery migrati a moduli compatti coerenti, con ricerca dolori e muscle map preservate.
- Su viewport fino a 480 px i moduli compatti restano in singola colonna per evitare compressione e overflow.
- Selettore periodo analytics normalizzato.
- Empty state del grafico peso reso coerente con il sistema.

### Allenamento attivo

- Timer restyling completo con icone Lucide e touch target 44–48 px.
- Nessuna modifica alla logica timer o persistenza.
- Esercizi trasformati in surface operative con toolbar coerente.
- Righe serie su griglia stabile Serie/Kg/Reps-or-Tempo/Extra.
- Focus della serie enfatizzato solo durante l'interazione.
- Dropset/isometrie ricomposti come righe secondarie leggibili.
- Storico e setup convertiti in pannelli inset.
- CTA finali uniformate alle varianti semantiche del design system.

### Auth

- Login/registrazione migrati da un blocco di stili inline a classi semantiche.
- Mantenuti ID e flussi di autenticazione esistenti.

### Documentazione

- Aggiornamento di `docs/design-system.md` con architettura, token, invarianti, accessibilità e regole di migrazione.

## Rischi e mitigazioni

- **Regressione E2E per classi UI:** classi legacy usate dai test vengono mantenute accanto alle nuove.
- **Overflow su viewport stretti:** griglie sessione hanno `minmax(0, 1fr)` e fallback specifico sotto 370 px.
- **Timer troppo largo:** dimensione controlli scende da 48 a 44 px sotto 370 px senza scendere sotto il minimo touch.
- **Specificità CSS legacy:** UI v2 viene caricata dopo `global.css`; gli inline statici vengono rimossi nei componenti migrati.
- **Costo GPU:** backdrop blur rimosso dalle card normali e conservato soltanto sulla navigation flottante/overlay rilevanti.
- **Regressioni funzionali:** nessun cambio a Zustand, Firebase, IndexedDB, sync, schema o storage.

## Verifiche richieste

Secondo `AGENTS.md`:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:e2e` per UI/testo/routing

In aggiunta:

- sessione attiva a 320/375/390/430 px;
- timer sticky + tre controlli senza overflow;
- bottom nav con safe area;
- login e home su viewport strette;
- focus keyboard e `prefers-reduced-motion`;
- preview Vercel e console browser.

## Rollback

Il lavoro è isolato su `restyling-gpt-2`. Il rollback consiste nel non integrare il branch oppure nel riportare il ref al parent commit; nessuna migrazione dati è coinvolta.
