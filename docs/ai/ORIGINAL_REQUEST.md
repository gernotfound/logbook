# Original User Request

## 2026-08-17T14:43:20Z

Due fix chirurgici alla PWA LogBook, entrambi relativi alla robustezza dei dati e al rispetto delle regole di `AGENTS.md`. Questo è un lavoro self-contained con due parti ben definite; usare un team piccolo e focalizzato.

Working directory: C:\Users\gerar\Documents\GitHub\logbook
Integrity mode: development

## Requirements

### R1. DomainParsers: da `.parse()` a fallback difensivo
In `src/lib/schema.ts`, l'oggetto `DomainParsers` (righe 346-357) usa `.parse()` su tutti i parser. Questa è una violazione della Regola 3 di `AGENTS.md` (Zod Gateway difensivo): se anche un solo record è corrotto (es. una sessione di allenamento su 500), l'intera chiamata `DB.loadUserData()` lancia un'eccezione e l'utente non può accedere ai suoi dati.

Ogni parser in `DomainParsers` deve essere reso robusto: i parser che restituiscono array devono usare un approccio che garantisca, in caso di dato singolo corrotto, il ritorno di un array con gli elementi validi (scartando quelli malformati) invece di lanciare un'eccezione. I parser che restituiscono un singolo oggetto devono usare un approccio che, in caso di dato corrotto, ritorni il valore di fallback corretto (es. `{}` o il default schema) invece di lanciare. Tutti i casi devono rispettare l'uso dei `.catch()` e `.default()` già presente nel resto di `schema.ts`.

### R2. Sostituzione `JSON.parse(JSON.stringify)` con `structuredClone` in `CycleEditor.tsx`
In `src/components/Training/planning/CycleEditor.tsx` alle righe 36 e 53, il codice usa `JSON.parse(JSON.stringify(...))` per clonare in profondità un array di routines. Sostituire entrambe le occorrenze con `structuredClone(...)` che è nativo nei browser moderni, più veloce e semanticamente corretto.

## Acceptance Criteria

### Compilazione e Stabilità
- [ ] `npm run build` si completa con 0 errori TypeScript.
- [ ] `npm run lint` passa con 0 errori e 0 warning.
- [ ] `npm test` passa integralmente (543/543 test).

### Verifica comportamento difensivo (R1)
- [ ] Ispezionando il codice finale di `src/lib/schema.ts`, nessun parser in `DomainParsers` usa `.parse()` puro che possa lanciare eccezioni non gestite su dati malformati.
- [ ] Un payload intenzionalmente malformato (es. array `history` contenente un elemento `null`) deve essere gestito senza bloccare il caricamento dell'intera struttura `UserData`.

### Verifica sostituzione (R2)
- [ ] Le righe 36 e 53 di `CycleEditor.tsx` non contengono più `JSON.parse(JSON.stringify`.
- [ ] Il comportamento del componente rimane identico: l'array clonato è indipendente dall'originale (nessuna mutazione condivisa).

## 2026-08-20T08:57:36Z

# Teamwork Project Prompt — Draft

> Status: Ready for launch — awaiting user approval
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Full team

Aggiornare il file di regole architetturali `AGENTS.md` per documentare in modo permanente la migrazione del deploy da GitHub Pages a Vercel, rimuovendo le vecchie istruzioni CI/CD e aggiungendo una rigida checklist per la configurazione dei domini su Firebase e Google Cloud.

Working directory: C:\Users\gerar\Documents\GitHub\logbook
Integrity mode: development

## Requirements

### R1. Pulizia Vecchia Architettura CI/CD
Rimuovere completamente da `AGENTS.md` ogni riferimento al precedente sistema di deploy. Questo include menzioni a GitHub Actions, al file `deploy.yml`, a GitHub Pages, e all'utilizzo del base path `/logbook/` in Vite. 

### R2. Documentazione Deploy su Vercel
Aggiornare la sezione relativa al deployment specificando che l'applicazione è ora ospitata su Vercel. Indicare che il deploy è automatico a ogni `git push`, che non è necessario un file di workflow dedicato, e che l'app gira sulla radice (`/`) del dominio.

### R3. Checklist Obbligatoria Sicurezza e Domini (Fail-Fast)
Aggiungere una checklist obbligatoria chiara per chiunque modifichi il dominio dell'app. La checklist deve imporre due passaggi critici:
1. L'aggiunta del nuovo dominio nella sezione "Authorized domains" di Firebase Authentication.
2. L'aggiunta del dominio con sintassi wildcard (es. `*nome.vercel.app/*`) nelle restrizioni HTTP referers della "Browser key" su Google Cloud Credentials, per evitare errori 403.

## Acceptance Criteria

### Verifica Oggettiva del Documento
- [ ] Eseguendo una ricerca testuale (es. `grep`) nel file `AGENTS.md`, le parole "GitHub Actions", "deploy.yml" e "GitHub Pages" non producono alcun risultato.
- [ ] Il file `AGENTS.md` contiene il nome "Vercel" come piattaforma ufficiale di hosting.
- [ ] È presente una checklist di sicurezza ben definita che menziona esplicitamente sia "Firebase Authentication (Authorized domains)" sia "Google Cloud (Browser key / referrers)" con l'esempio della sintassi wildcard con l'asterisco.
