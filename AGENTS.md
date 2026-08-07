# Regole di Progetto - LogBook

## 1. Verifica Reale del Codice (Zero Teoria)
- Prima di formulare analisi, diagnosi o proposte di refactoring, ispezionare SEMPRE i file sorgente con gli strumenti di ricerca (grep) e lettura.
- Verificare sempre cosa e gia implementato nel progetto prima di suggerire ottimizzazioni.
- Non fornire risposte basate su assunzioni teoriche: ogni affermazione tecnica deve fare riferimento ai file e alle righe reali del codice.

## 2. Flusso Git Obbligatorio
- Al termine di ogni singola modifica o richiesta completata con successo:
  1. Eseguire il build di verifica (npm run build).
  2. Eseguire automaticamente git add, git commit con messaggio chiaro e git push origin main.
  3. Non attendere che l'utente debba sollecitare il push.

## 3. Standard Mobile e iOS PWA
- Tutti gli elementi interattivi (input, select, textarea) devono avere font-size: 16px !important per impedire lo zoom automatico su iPhone.
- Tutti i campi input (inclusi type="date", type="time", type="number") devono avere box-sizing: border-box, max-width: 100%, display: block e appearance: none.
- Nei contenitori flex, applicare sempre min-width: 0 per evitare overflow orizzontali.
- I campi data e orario su Safari iOS devono essere centrati con selettore ::-webkit-date-and-time-value.
- Rispettare sempre le safe-area insets di iOS (env(safe-area-inset-top) ed env(safe-area-inset-bottom)).

## 4. Integrita Funzionale e Modello Dati
- Il manichino muscolare vettoriale (MuscleModel) deve rimanere sempre visibile nella pagina Schede, anche a lista esercizi vuota.
- L'archivio alimenti deve essere vuoto all'inizio: nessun alimento hardcoded o non modificabile; l'utente gestisce solo i propri alimenti personali.
- Nessuna funzionalita o componente preesistente deve essere rimosso o modificato se non esplicitamente richiesto dall'utente.

## 5. Qualita e Prestazioni
- Ogni commit deve superare la compilazione TypeScript e Vite senza errori o avvisi bloccanti.
- Mantenere la sincronizzazione locale e la persistenza offline di Firestore senza introdurre blocchi sul thread principale della UI.
