# TheLogBook — migrazione Cloudflare: runbook corrente

**Classificazione: CRITICAL · stato PARZIALE / NO-GO Production.** La fonte di verità per il codice e i test è `main` GitHub; per risorse e runtime sono i rispettivi provider. Questo documento descrive **contratti correnti e blocchi**, non lo storico di commit. [EPIC #1053](https://github.com/gernotfound/logbook/issues/1053) · [registro servizi](external-services-register.md) · [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063).

## Decisioni confermate

- **Fresh start:** non esistono account/dati pre-lancio da trasferire; niente migrazioni Firebase→D1 di utenti, password, chiavi, consensi, sessioni o dati sanitari. Preservare invece tutte le funzioni approvate, il motore locale e i formati che il sistema nuovo effettivamente creerà.
- **Frontend:** Cloudflare Workers Static Assets; **backend:** API Workers e D1 SQL con giurisdizione `eu` da verificare sull'istanza effettiva. Nessun billing o upgrade autorizzato.
- **Identità:** Kinde scelto per Email e Google; questi pulsanti sono stati abilitati nell'onboarding. **Metodo email/password ≥15 caratteri, Google OAuth, reset/verifica e sessioni non sono ancora collaudati**. I messaggi Auth saranno gestiti da Kinde, senza un servizio email separato.
- **Confini di fiducia:** Kinde conferma l'identità; Workers/D1 devono autorizzare owner, stato account, consenso salute, revoca, cancellazione, sessioni e quote. Nessun dato salute in chiaro su Kinde o D1. Una sessione valida e un JWT firmato non sostituiscono consenso e owner fence.
- **Dismissione:** eliminare funzioni Firebase/Vercel solo dopo aver verificato il percorso equivalente. Non mantenere compatibilità con installazioni pre-lancio inesistenti. Cutover `thelogbook.me`, DNS, OAuth/posta Production, credenziali e dismissioni irreversibili richiedono mandato e GO separati.

## Stato osservato e limiti delle prove

| Componente | Stato osservato | Prova ancora mancante |
|---|---|---|
| GitHub | Candidati Cloudflare e verificatori Kinde integrati; CI e CodeQL su SHA specifici | La CI non dimostra API Cloudflare o login live |
| Static Assets | Worker `thelogbook-frontend` pubblicato su `workers.dev`, solo binding `ASSETS` nell'ultimo inventario Cloudflare | Custom domain, PWA aggiornata, login/UX e Safari iOS |
| D1 | Sandbox `thelogbook-cf02-eu-isolated-20261113`, `jurisdiction=eu`; migration `0001` e `0002` osservate sul provider con dati sintetici | Le migration successive, API HTTP, query/CPU/quote reali e database Production non sono attestati |
| Workers API/Auth | `cloudflare/api/worker.mjs`, session gate, issuer, consenso e replica nel repository; **nessuna API Worker pubblicata** nel controllo provider disponibile | Binding isolati, callback OAuth trusted, session issuance end-to-end, prove browser e runtime |
| Kinde | Business `thelogbook.kinde.com` in regione `Europe - Ireland` secondo schermate; selezionati metodi Email e Google nell'onboarding | Applicazione OAuth, codice autorizzazione + PKCE/state/nonce monouso, password, email, claim reali, retention e antiabuso |
| DNS e provider legacy | Zona Cloudflare attiva, web ancora su IONOS; Hosting Firebase disabilitato secondo proprietario, Vercel `logbook` sospeso secondo verifica provider | Cutover del dominio, nuovo backend e ritiro del codice legacy dopo test |

Il `jurisdiction=eu` della D1 **non garantisce** localizzazione europea di Workers, log, email, Google OAuth o tutti i subprocessori. Non dedurre conformità GDPR da un singolo flag.

## Integrazioni candidate presenti nel repository

**Auth (CF-03):** `cloudflare/auth/kinde-token-verifier.mjs` verifica firma JWKS RS256, issuer, audience API, client/azp, scadenza e subject. `kinde-login-proof.mjs` verifica in più ID token, audience distinta, `email_verified`, nonce, corrispondenza del soggetto e `at_hash` se presente. `kinde-principal-provisioner.mjs` è un candidato **interno, non un endpoint**: dopo quella verifica deriva un UID D1 stabile da SHA-256 con separazione di dominio su `(issuer, subject)` e inserisce una sola volta un principal verificato; una lettura primary-sequential conferma l'esito, senza riattivare principal disabled/deleted né azzerare epoch. Non importa dati Firebase e non salva email o salute. Il callback reale deve ancora creare e consumare un `state` monouso server-side, verificare il code exchange PKCE e fornire il nonce originale prima di chiamare il provisioner e, solo dopo prova autorevole, `session-issuer.mjs`. In caso di risposta D1 ambigua non si emette una sessione. Resta da verificare revoca Kinde e modifica successiva dello stato email. `session-gate.mjs` controlla sessione e autorizzazioni per gli accessi successivi. Mai accettare UID o nonce direttamente dal client come prova sufficiente. [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057).

**Replica (CF-01/02/04):** `cloudflare/api/worker.mjs`, `d1-document-store.mjs` e `replica-maintenance.mjs` definiscono il trasporto D1 con SQL CAS, session/consent fence e receipt. `cloudReplicaDurableDelivery.ts` e i moduli contigui persistono il batch ciphertext e il prefisso journal in IndexedDB **prima** della rete; una ricevuta originale verificata autorizza solo l'ACK di quel prefisso, mai un successo su timeout o stato ambiguo. È vietato esporre un'API con AuthGate sintetico o collegare D1 a `replicateJournal()` prima del percorso identità/consenso reale. [CF-04 #1058](https://github.com/gernotfound/logbook/issues/1058).

**Consenso, cifratura e cancellazione (CF-05/06):** migrazioni `0003`–`0006`, gate del consenso e worker di cancellazione health sono candidati locali nel repository. Il runner bounded usa lease/epoch, avanzamento per tabelle e rifiuto di completamento fittizio: uno stato `awaiting-keys` **non è** `complete`. Restano da collegare chiavi cloud, diritti, export, erasure completa e receipt, recovery, account Kinde e cron sul Worker reale. La DEK device e la chiave cloud account rimangono indipendenti. Non promettere E2EE/zero-knowledge né recupero impossibile. [CF-05 #1059](https://github.com/gernotfound/logbook/issues/1059) · [CF-06 #1060](https://github.com/gernotfound/logbook/issues/1060).

**Sicurezza perimetrale (CF-07):** Turnstile, quando usato, deve avere Siteverify server-side con hostname/action e token monouso; Cloudflare WAF non protegge automaticamente gli endpoint hosted Kinde. Limitare richieste, body, CPU, query e abuso di email/login; verificare anche accessi diretti tramite `workers.dev`, version/preview e custom domain. Un limite Free o un errore del provider devono fallire in sicurezza senza perdere journal o concedere ACK fittizi. [CF-07 #1061](https://github.com/gernotfound/logbook/issues/1061).

## Sequenza di completamento

1. Su tenant Kinde isolato: verificare policy password ≥15 su registrazione e reset, login Google, email verificata, MFA, logout/revoca, erasure via API nel Free, privacy/retention e redirect Safari/iOS. Non trascrivere token, chiavi o dati personali nel repo.
2. Implementare callback OAuth code + PKCE/state/nonce server-owned monouso, mappatura account D1 e sessione applicativa con cookie Secure/HttpOnly/SameSite + CSRF; prova multi-tab/multi-device e revoca effettiva.
3. Collegare ADK/device vault e consenso prima della replica; provare D1 su dati sintetici, ACK, offline, conflitti, crash, lost-response e owner isolation, sempre senza salute plaintext lato server.
4. Completare export/delete, revoca salute, cancellazione account (identità Kinde compresa), inattività 12 mesi, backup/restore e job bounded; errori e retry devono lasciare ricevute verificabili.
5. Misurare quote Free, CPU/storage, denial-of-service, privacy e sicurezza; verificare UX per viewport/theme/accessibilità, update PWA e rollback su Safari. Solo dopo i gate GitHub exact-SHA, provider e GO del proprietario effettuare eventuale cutover del dominio.

Le parti indipendenti possono avanzare in parallelo a CF-00, ma **nessuna dipendenza non validata può essere attivata nel percorso reale**. Non eseguire deploy non-main su risorse Production o test su dati Production.

## Contratti e tracciamento

[AGENTS](../../AGENTS.md) · [Account](../../.agents/rules/account-lifecycle.md) · [Archivio cifrato](../../.agents/rules/secure-storage.md) · [Storage/sync](../../.agents/rules/storage-and-sync.md) · [Consenso](../../.agents/rules/health-consent.md) · [CI](../../.agents/rules/ci-verification.md) · [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054) · [CF-09 #1063](https://github.com/gernotfound/logbook/issues/1063) · [hosting/DNS #1041](https://github.com/gernotfound/logbook/issues/1041). Lo storico degli incrementi è consultabile nella cronologia Git e nelle PR, non copiato come checklist nel runbook corrente.
