# Original User Request

## 2026-08-23T07:34:04Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Team completo

Correggere la modalità guest affinché esercizi e alimenti standard provengano sempre dal catalogo globale risolto (cache valida o fallback seed), garantendo che la pipeline di risoluzione sia unificata tra guest e utenti autenticati e che il catalogo seed non venga mai accidentalmente persistito come dato personale.

Working directory: C:\Users\gerar\Documents\GitHub\logbook
Integrity mode: development

## Requirements

### R1. Contratto di Stato e Risoluzione Unica
Verificare e rispettare il contratto attuale di `library` e `customFoods` nello store. Le view devono ricevere una singola lista già risolta (catalogo globale + custom + override - nascosti), calcolata preferibilmente nel bootstrap/store tramite `resolveEffectiveExercises`/`resolveEffectiveFoods` o selettori memoizzati. Evitare doppie risoluzioni in fase di render e non forzare modifiche alle view se queste stanno già leggendo la lista correttamente derivata.

### R2. Bootstrap del Catalogo senza Login
Prima del primo render utile deve esistere un catalogo non vuoto: usare il catalogo in memoria se già inizializzato; altrimenti attendere la lettura da IndexedDB nel bootstrap già previsto; se assente o invalida, inizializzare immediatamente dai seed statici bundled (`seedExercises.json`, `seedFoods.json`). L'eventuale sincronizzazione remota aggiorna la cache in background e non deve mai svuotare o bloccare le liste esposte alla UI.

### R3. Sicurezza della Persistenza e Merge
La lista risolta è uno stato derivato/UI e non deve MAI essere serializzata come lista personalizzata. La persistenza (guest, IndexedDB, salvataggio cloud) deve contenere esclusivamente i delta: elementi custom, override (`catalogOverrides`) e ID nascosti. Al collegamento dell'account Google, il merge deve unire questi delta ai dati cloud senza duplicare il catalogo seed. Verificare con attenzione la logica di estrazione in `DB.saveUserData`.

## Acceptance Criteria

### Unit e Integration Tests (Vitest)
- [ ] **Avvio a freddo guest:** Simula il primo accesso guest con IndexedDB vuoto; verifica che esercizi e alimenti standard siano disponibili istantaneamente grazie ai seed.
- [ ] **Regressione persistenza:** Dopo l'avvio guest e il rendering della lista completa, simula un salvataggio e verifica esplicitamente che il payload destinato al salvataggio (o alla cache) contenga solo elementi effettivamente custom/override, senza duplicare l'intero array seed.
- [ ] **Transizione sorgenti senza flash:** Verifica che passando progressivamente da seed -> cache -> sync remoto, la lista visualizzata non transiti mai per uno stato vuoto (`[]`), preservando filtri e personalizzazioni senza duplicazioni.
- [ ] **Merge post-guest:** Simulando un login Google dopo l'uso guest, il merge unisce custom/override guest ai dati cloud senza duplicare i seed array in `library` o `customFoods`.

### UI / UX
- [ ] **Verifica presenza specifica:** In modalità "Prova", i test o l'UI mostrano non solo una lista `length > 0`, ma attestano la presenza di elementi specifici e noti appartenenti al seed (per garantire che non si stia mostrando solo un finto elemento custom).
