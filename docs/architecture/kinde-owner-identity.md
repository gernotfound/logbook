# CF-01 / ADR-1 — identità stabile del proprietario Kinde

**Stato:** decisione tecnica adottata nella baseline *candidata* Workers/D1; non autorizza l'accesso fitness pubblico. **Ambito:** mapping dell'identità, namespace e cancellazione account. Le ADR sui flussi, sulle versioni e sui limiti di rilascio restano aperte in [#1055](https://github.com/gernotfound/logbook/issues/1055).

**Fonti del contratto:** [AGENTS](../../AGENTS.md), [ciclo account](../../.agents/rules/account-lifecycle.md), [archivio cifrato](../../.agents/rules/secure-storage.md), [consenso salute](../../.agents/rules/health-consent.md). Questo documento descrive una scelta tecnica verificabile nel codice; lo stato di D1, Kinde e del browser va rilevato separatamente al momento dell'uso.

## Decisione

L'identificativo interno dell'account (`uid`) è **deterministico e opaco**, derivato esclusivamente nel Worker trusted dalla coppia `(issuer Kinde, subject Kinde)` autenticata. La derivazione canonica v1 è:

```text
bytes = UTF8("thelogbook:kinde-owner:v1\0" + issuer + "\0" + subject)
uid = "k_" + base64url_no_padding(SHA256(bytes))
```

Il risultato è una stringa di 45 caratteri. `issuer` deve essere un'origine HTTPS canonica senza porta esplicita; `subject` deve rispettare il formato Kinde accettato dal verificatore corrente (`kp_` oppure `kp:` seguito da caratteri ammessi). La separazione per dominio e per issuer impedisce di trattare un subject uguale proveniente da tenant diversi come lo stesso proprietario. **L'UID non è un segreto né una chiave di cifratura.**

La fonte unica dell'UID è [`deriveKindeOwnerId`](../../cloudflare/auth/kinde-owner-id.mjs). Il callback OAuth e il target di cancellazione riusano lo stesso helper: non sono ammesse implementazioni indipendenti del digest, mapping tramite email o UID scelti dal browser. Se Kinde fornisce subject distinti per metodi di accesso distinti, questa decisione **non li collega** automaticamente, anche quando l'email coincide. Il collegamento esplicito di identità è una funzionalità diversa, da provare sul tenant e progettare prima di abilitarla.

## Confini di fiducia e persistenza

| Confine | Contratto e prova richiesta |
|---|---|
| Kinde → callback | Codice OAuth scambiato server-side con PKCE, stato e nonce originali monouso. Verifica di firma JWT, issuer, audience distinti, client/`azp`, subject coincidente, scadenze, nonce, `email_verified` e `at_hash` quando presente. Un'email o un token fornito dal client non determinano l'UID. |
| Callback → D1 `auth_principals` | `uid` è chiave primaria. Provisioning `INSERT ... ON CONFLICT DO NOTHING` e lettura dal primary sotto la sessione D1; nessuna risposta positiva dopo scrittura o readback ambiguo. Un principal `disabled`/`deleted` non viene riattivato e l'`auth_epoch` non torna indietro. |
| Sessione → API | Il cookie HttpOnly identifica una sessione casuale il cui hash è in D1. Il gate rilegge principal, epoch, revoca e scadenze; CSRF, verifica email, consenso e stato del subject sono autorizzazioni separate. Il solo UID non conferisce nessun diritto fitness. |
| API → dati account | Il server impone owner e generazione nei predicati e negli ACK. Il client costruisce il namespace locale `user:${uid}` soltanto dopo la prova trusted di sessione/consenso; il guest rimane un owner indipendente, senza adozione implicita. |
| Cancellazione → Kinde | Il subject necessario alla chiamata di cancellazione è sigillato con AES-GCM e AAD che lega formato, issuer, key ID e UID. All'apertura viene ricalcolato l'UID. Il provider è chiamato **per ultimo**, dopo le prove di erasure applicativa e i fence; un suo ACK non è una ricevuta di cancellazione completa. |

Le chiavi mantengono confini distinti: vault/DEK casuale per dispositivo; ADK casuale per account e consenso, wrappata sul server sotto KEK; identificativo owner incorporato nell'AAD. Né l'hash UID, né il subject, né la password/token Kinde sostituiscono quelle chiavi. Il backend trusted può materialmente ottenere l'ADK: **non promettere E2EE**. Cifratura, recovery e diritti sono governati dai rispettivi contratti, non da questa ADR.

## Invarianti e condizioni di modifica

1. Un accesso verificato ripetuto alla stessa coppia `(issuer, subject)` restituisce lo stesso UID; cambiare issuer o subject crea una **identità distinta**. Email, display name, provider di login e dati del profilo non sono chiavi del mapping.
2. Due richieste concorrenti di primo login possono incontrare la stessa chiave primaria, ma non creare due proprietari; il readback deve confermare lo stato attivo senza riportare a 1 un epoch già avanzato. Errori o risposte perse falliscono senza sessione inventata.
3. Logout, revoca, sospensione e cancellazione sono transizioni separate. Un precedente `uid` identico dopo un cambio A→B→A non ricostruisce una sessione, un consenso o una concessione di vault scaduti.
4. Il namespace `user:${uid}` e gli owner-bound AAD/record non autorizzano l'accesso per semplice corrispondenza testuale. Guest e altri UID non si ereditano; corruzione e ciphertext orfano bloccano il bootstrap preservando i byte.
5. Il cambio del formato subject, dell'issuer, del digest o del prefisso UID è **un cambio di identità persistita**. Dopo l'apertura a dati reali richiede un piano esplicito per sessioni, riferimenti D1, chiavi/AAD, journal locale, backup, erasure e client offline; non introdurre fallback di linking per email né conversioni pre-lancio immaginarie.
6. Il record cifrato di cancellazione e la sua chiave di apertura devono restare disponibili fino alla prova terminale. Perdita della chiave, token errati, subject incoerente o risposta ambigua del provider significano lavoro incompleto, non successo.

## Alternative escluse e rischi residui

- **Email come identificatore:** mutabile, non necessariamente verificata e potenzialmente condivisa fra modalità di accesso. Consentirebbe un collegamento non dimostrato fra account.
- **UID random creato in un mapping separato:** possibile ma richiederebbe una seconda associazione atomica e una sua ricostruzione durabile per erasure. Nel fresh start corrente non aggiunge un beneficio dimostrato rispetto al digest derivato dopo la verifica della coppia firmata.
- **Subject Kinde in chiaro come UID:** esporrebbe inutilmente l'identificatore provider nei namespace e nei protocolli applicativi.

La resistenza alle collisioni di SHA-256 non è una prova matematica di impossibilità: l'unicità nel database è imposta dalla chiave primaria, mentre l'identità della coppia rimane affidata alla verifica Kinde. Un soggetto compromesso presso l'identity provider, XSS o accesso alla KEK sono minacce differenti, non mitigate dal solo hash. Il modello di linking e le prove tenant (email/password, Google, reset, cambio email, reauth) restano aperti in [#1057](https://github.com/gernotfound/logbook/issues/1057). Anche erasure reale, KEK/ADK e recovery richiedono prove autonome in [#1059](https://github.com/gernotfound/logbook/issues/1059) e [#1060](https://github.com/gernotfound/logbook/issues/1060).

## Evidenze riproducibili e limite

- **Implementazione:** `cloudflare/auth/kinde-owner-id.mjs`, `kinde-login-proof.mjs`, `kinde-principal-provisioner.mjs`, `session-gate.mjs`, `session-issuer.mjs`; `cloudflare/jobs/kinde-erasure-target.mjs`, `kinde-erasure-management.mjs`; `cloudflare/api/migrations/0003_auth_session_gate.sql`, `0012_kinde_erasure_decisions.sql`.
- **Regressioni:** `tests/cloudflare/cf03-kinde-login-proof.node.mjs` e `cf06-kinde-erasure-target.node.mjs` includono firma/nonce, subject e tenant diversi, provisioning concorrente, stato disabled/deleted, lost ACK, sigillo e cancellazione con fence. I test sintetici non sostituiscono il browser, il tenant e il database remoto.
- **Non attestato qui:** mapping di account Kinde reali dopo eventuale linking, custodia/restore KEK, completamento della cancellazione nel provider, comportamento Safari/iOS, applicazione di tutte le migrazioni isolate e GO del prodotto.

L'ADR definisce **come nominare il proprietario**. Non approva da sola l'accesso ai dati salute, né dichiara concluse le altre ADR di [#1055](https://github.com/gernotfound/logbook/issues/1055).
