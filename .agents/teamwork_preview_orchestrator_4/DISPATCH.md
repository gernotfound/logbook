## 2026-08-20T08:58:16Z
Target File: c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
Authoritative Request: c:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md

The user requested an architectural documentation update to `AGENTS.md`:
1. R1. Pulizia Vecchia Architettura CI/CD: Rimuovere completamente da `AGENTS.md` ogni riferimento al precedente sistema di deploy. Questo include menzioni a GitHub Actions, al file `deploy.yml`, a GitHub Pages, e all'utilizzo del base path `/logbook/` in Vite.
2. R2. Documentazione Deploy su Vercel: Aggiornare la sezione relativa al deployment specificando che l'applicazione è ora ospitata su Vercel. Indicare che il deploy è automatico a ogni `git push`, che non è necessario un file di workflow dedicato, e che l'app gira sulla radice (`/`) del dominio.
3. R3. Checklist Obbligatoria Sicurezza e Domini (Fail-Fast): Aggiungere una checklist obbligatoria chiara per chiunque modifichi il dominio dell'app. La checklist deve imporre due passaggi critici:
   - L'aggiunta del nuovo dominio nella sezione "Authorized domains" di Firebase Authentication.
   - L'aggiunta del dominio con sintassi wildcard (es. `*nome.vercel.app/*`) nelle restrizioni HTTP referers della "Browser key" su Google Cloud Credentials, per evitare errori 403.

Acceptance Criteria:
- Eseguendo una ricerca testuale (es. grep) nel file `AGENTS.md`, le parole "GitHub Actions", "deploy.yml" e "GitHub Pages" non producono alcun risultato.
- Il file `AGENTS.md` contiene il nome "Vercel" come piattaforma ufficiale di hosting.
- È presente una checklist di sicurezza ben definita che menziona esplicitamente sia "Firebase Authentication (Authorized domains)" sia "Google Cloud (Browser key / referrers)" con l'esempio della sintassi wildcard con l'asterisco.
- Eseguire i controlli di qualità e test di rito (`npm test`, `npm run build`, `npm run lint`) per confermare che l'intero progetto sia in perfetto stato.
