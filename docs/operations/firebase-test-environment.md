# Ambiente di test isolato — TheLogBook

> **Stato:** preparazione in corso, ambiente NON ancora pronto per eseguire E2E.
> **Ambito:** Firebase Test e futuro backend Vercel Test, separati dal runtime Production.
> **Ultimo aggiornamento:** 2026-10-16. Le configurazioni elencate come "riferite" sono state mostrate dal product owner tramite console/screenshot; NON costituiscono verifica diretta via API del provider.

## Obiettivo e limiti

Eseguire prove con account e dati esclusivamente fittizi per autenticazione, sincronizzazione, funzionamento offline, revoca del consenso e cancellazione dei dati salute mantenendo l'account (PR #429). La repository e il codice sorgente rimangono `gernotfound/logbook`; l'ambiente di test deve avere risorse, privilegi, credenziali e deployment isolati. Niente operazioni distruttive su utenti o dati Production.

L'allestimento **non** autorizza merge su `main`, modifica delle credenziali Production, modifiche al ruleset, deploy Production o creazione di dati nel progetto Firebase reale. Prima di qualunque test distruttivo, verificare l'identità dell'account e i project ID di tutte le connessioni del frontend e backend.

## Configurazione Firebase Test — comunicata dal product owner

| Elemento | Configurazione riferita | Evidenza / limite |
|---|---|---|
| Progetto | `TheLogBook Test`, ID `thelogbook-test` | Dati in Firebase Console forniti dal product owner |
| Numero progetto | `1016481853013` | Dato fornito dal product owner |
| Ambiente GCP | Non specificato | Nessun effetto sull'isolamento da Production |
| Cloud Firestore | database `(default)`, regione Torino (`europe-west12`) | Confermato dal product owner; API del provider non ancora verificate |
| Firestore Security Rules iniziali | `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }` | Copiate dal product owner; **client read/write negati** finché non si applicano Rules applicative testate |
| Authentication | Metodo Email/Password abilitato | Riferito dal product owner; account fittizi non ancora creati |
| Domini Auth autorizzati | `localhost`, `thelogbook-test.firebaseapp.com`, `thelogbook-test.web.app` | Tabella dalla console fornita dal product owner; nessun dominio Production riportato |
| Web app | `TheLogBook Test Web`; una sola registrazione finale | Un duplicato omonimo è stato eliminato dal product owner |
| Firebase Hosting | `thelogbook-test.web.app`, `thelogbook-test.firebaseapp.com` | Domini predefiniti attivati, nessuna distribuzione della PWA Test attestata |
| Google Cloud reCAPTCHA Enterprise | API abilitata; chiave **Web** `TheLogBook Test - App Check Web` | Screenshot Google Cloud: domini Test configurati, verifica dominio attiva |
| Firebase App Check | Web app registrata con Fraud Defense / reCAPTCHA Enterprise; site key (ID, non secret key) | Screenshot registrazione e successiva conferma correzione chiave dal product owner |
| App Check enforcement | **Non applicato** per Cloud Firestore e Firebase Authentication | Screenshot scheda API di Firebase App Check; mantenere disattivo fino a collaudo token |
| Token TTL App Check | 1 ora mostrata nell'interfaccia prima della registrazione | Controllare valore effettivo nella console se rilevante |

**Chiavi:** non copiare qui né in GitHub API key, site key, secret key reCAPTCHA, chiavi service account, token, password, email degli utenti o fatturazione. Una prima registrazione App Check ha utilizzato per errore la secret key legacy; il product owner ha successivamente riferito di aver sostituito il valore con la site key (ID) corretta. Il token App Check non è stato ancora collaudato su un sito Test pubblicato.

## Vercel Test — in preparazione

- Team selezionato: `gnfcreator`.
- Repository da importare: `gernotfound/logbook` (la stessa di Production, **nessuna seconda repo**).
- Nome scelto per il progetto: `thelogbook-test-backend`.
- Root Directory: `./`; preset applicativo selezionato: **Other**.
- **Stato osservato 2026-10-16:** schermata New Project compilata; creazione progetto e primo deploy NON eseguiti. La lettura diretta Vercel del progetto `thelogbook-test-backend` ha restituito **404 Project not found**. Il tentativo di crearlo tramite connettore **senza collegamento Git e senza deploy** è stato rifiutato da Vercel con **403 Forbidden** (permessi insufficienti); nessun progetto o deploy risulta creato da quel tentativo. Non premere Create Project o Deploy finché i guardrail sotto non sono predisposti.

### Guardrail necessari prima del primo deploy

1. Il `vercel.json` della baseline imposta `git.deploymentEnabled.main=true` e `**=false`. **Prima di importare il progetto su Vercel**, identificare nella schermata New Project l'eventuale selettore del branch, scegliere il branch Test, non `main`, e assicurarsi che non parta un deployment iniziale non isolato. Configurare `testing/00-firebase-test-critical` come Production Branch del solo progetto Vercel Test e disabilitare i deploy Preview dal branch `main`. Il `vercel.json` del branch Test richiederà un profilo esplicito di distribuzione del solo branch Test; non usare un auto-deploy main-only né indebolire il gate canonico. Verificare le impostazioni **effettive** nel provider prima del primo rilascio.
2. La baseline include `/api/account-deletion-cron` programmato giornalmente e un redirect dalla root all'URL Production: esaminare/neutralizzare entrambi per il Test, **senza** modificare il runtime Production.
3. Provisionare l'identità Firebase Admin **del progetto Test** in Vercel Test, con IAM minimo e App Check replay verification se necessario. Mai riutilizzare le variabili `FIREBASE_ADMIN_*` di Production.
4. Definire `PUBLIC_APP_ORIGIN` e origini CORS Test; evitare accessi cross-environment. Tenere separate le env client `VITE_FIREBASE_*`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` e `VITE_ACCOUNT_DELETION_API_ORIGIN`. Verificare CSP, OAuth e domini di origine.
5. Effettuare controlli fail-closed della destinazione prima dei deploy Firestore/Hosting; distribuire Rules e indici Test dal commit verificato, poi frontend Test e backend Test. Nessun workflow Test deve cambiare il workflow o le risorse Production.
6. Collegare il test E2E a UID/account fittizi; simulare offline/revoca/cancellazione e confermare la persistenza dell'account, senza coinvolgere dati utente reali.
7. Tenere separati gate canonico, CI, deploy, smoke HTTP e prove E2E autenticate: non dichiararli completati in assenza di evidenza osservata.

## Gestione GitHub

- Branch dedicato: `testing/00-firebase-test-critical`, creato dal remoto `main` allo SHA `58c41265a40af7e13f11244e54d957b85111aea4`.
- Branch a lunga durata per la **preparazione** dell'ambiente Test, non un branch da fondere automaticamente. `main` può progredire indipendentemente.
- Prima delle modifiche successive, ricontrollare il vero `main` remoto, i delta e le regole di `AGENTS.md` e `.agents/rules/`.
- Proposta di protezione: impedire cancellazione accidentale e force-push, mantenendo normale avanzamento via commit; verificare eventuali vincoli GitHub già presenti e i permessi amministrativi prima di applicarli.
- **Nessuna PR o merge autorizzati** per questa fase di sola infrastruttura Test. Ogni eventuale integrazione in `main` va concordata esplicitamente col product owner.

## Prossime verifiche

- [ ] Verifica stato/protezioni GitHub del branch dedicato.
- [ ] Finalizzare e verificare configurazione backend Vercel Test senza deploy da `main`.
- [ ] Verifica API key browser, restrizioni/referrer e registrazione App Check nel progetto Firebase Test.
- [ ] Provisioning IAM/Test e credenziali solo nel provider, mai nel repository.
- [ ] Installazione Rules e indici su Firestore Test dopo gate/emulator.
- [ ] Deploy PWA su Hosting Test con configurazione frontend e CSP separate.
- [ ] Test token App Check senza enforcement, poi valutarne attivazione.
- [ ] Test E2E autenticato su dati fittizi e documentazione dei risultati reali.
