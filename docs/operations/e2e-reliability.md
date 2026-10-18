# Collaudi E2E e affidabilità PWA

## Prove disponibili e limiti

- `npm run test:e2e` compila la PWA con configurazione Firebase/App Check **sintetica**, backend trusted su una porta loopback non servita e senza valori Production ereditati. Il server Vite Preview è locale; la fixture Playwright blocca le richieste browser fuori dalla propria origine. La configurazione sintetica della build protegge anche dalle richieste di Service Worker che Playwright non intercetta.
- `npm run test`, i test Firebase Emulator e le suite backend verificano contratti e casi negativi, ma non sostituiscono un login reale con Auth, Firestore e App Check. Il gate `npm run verify:m8` o la CI exact-SHA equivalente resta obbligatorio.
- Playwright Mobile Safari usa WebKit e un viewport emulato; non prova installazione su dispositivi fisici, sospensione iOS o aggiornamento reale tra versioni PWA.
- Dal **18 ottobre 2026** i progetti separati Firebase `thelogbook-test` e Vercel `thelogbook-test-backend` sono stati eliminati. La [issue #426](https://github.com/gernotfound/logbook/issues/426) è chiusa come non pianificata. **Non esiste un ambiente cloud Test isolato**: non configurare credenziali, account o workflow destinati a quello dismesso e non puntare test automatici verso Production.

## Scenari autenticati e di recupero — stato dopo la dismissione

La precedente lista di collaudi live (storico [#375](https://github.com/gernotfound/logbook/issues/375)) richiedeva account sintetici su un cloud indipendente, mai dati utente reali. **Non è più una procedura eseguibile sull'infrastruttura attuale.**

- **Si continuano a eseguire** prove deterministiche di isolamento owner, consenso e revisioni, logout protetto, guest→account, replica, reload, offline, errori App Check e recovery tramite Vitest, Firebase Emulator e Playwright locali.
- **In Production sono consentiti soltanto smoke non distruttivi e mirati**, come apertura/navigazione, letture autorizzate, autenticazione normale e verifica di asset, errori e deploy; annotare SHA/release, browser, dispositivo ed esito. Non avviare per collaudo revoche, cancellazioni, import, reset di storage, scritture conflittuali o perdita volontaria della connessione mentre ci sono dati non sincronizzati.
- **Restano non verificati live** su un ambiente isolato i flussi autenticati con due owner, prima accettazione e revoca/riaccettazione, guasti del backend/App Check, recovery cross-device e cancellazione account. Non dichiarare che una CI verde certifichi questi scenari.
- Qualunque nuovo ambiente non-Production, collaudo distruttivo o cambio ai gate richiede una nuova decisione del product owner; non ripristinare automaticamente Firebase/Vercel Test perché una proposta storica lo menziona.

## Collaudi reali PWA non sostituibili dal browser simulato

Su Safari iOS normale e PWA installata, Chrome Android/PWA installata e desktop, quando disponibili: verificare in modo **non distruttivo** navigazione, presentazione, fusi orari/DST, tema, viewport e comportamento visibile al ritorno in foreground. Su Production non forzare reload o aggiornamenti con modifiche locali pendenti. Il confronto tra **due versioni reali** e la recovery offline avversariale restano prove non effettuabili in sicurezza senza isolamento adeguato; simulare l'evento `logbook:pwa-update-waiting` dimostra soltanto il prompt.

## Confine Production e fixture sintetiche

Il progetto Firebase Production `logbook-db-98cc4`, il frontend `thelogbook.web.app` e il backend `logbook-gnf.vercel.app` **non sono sandbox**. Nessuna suite E2E automatica deve creare, modificare o cancellare dati reali in questi servizi. Il file `.env.test` contiene soltanto placeholder per il contesto di test locale, non è un riferimento a un Firebase Test funzionante. Non introdurre un origin di test condiviso, un account sintetico live o un meccanismo di cancellazione automatica sul progetto Production senza una decisione esplicita e un nuovo perimetro di sicurezza.
