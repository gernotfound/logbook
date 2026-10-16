# Collaudi E2E e affidabilità PWA

## Prove disponibili e limiti

- `npm run test:e2e` compila la PWA con configurazione Firebase e App Check sintetica, backend trusted su una porta loopback non servita e senza valori Production ereditati. Il server Vite Preview è locale; la fixture Playwright blocca le richieste browser fuori dalla sua origine. Playwright non può intercettare tutte le richieste generate da Service Worker: la configurazione sintetica della build è una protezione indipendente.
- `npm run test`, i test Firebase Emulator e le suite backend verificano contratti e casi negativi ma non costituiscono un login con Auth e App Check reali. `npm run verify:m8` oppure il workflow exact-SHA equivalente resta obbligatorio.
- La copertura Playwright Mobile Safari usa WebKit e un viewport emulato; non prova l'installazione su iPhone/iPad fisico, la sospensione iOS o l'aggiornamento tra due versioni reali della PWA.
- La configurazione effettiva di Firebase Test e del backend trusted separato va verificata direttamente nei provider. La [issue #426](https://github.com/gernotfound/logbook/issues/426) raccoglie i requisiti e i controlli di isolamento, ma non attesta il loro completamento. I test automatici ordinari non devono accedere a dati/account Production.

## Scenari autenticati di consenso e recovery (riferimento storico #375)

Registrare SHA/release, data, origine, browser, dispositivo e risultato. Usare un account di prova controllato; non cancellare un account reale, non forzare dati nel backend e non condividere token, segreti o backup.

1. In un ambiente Firebase Test realmente separato, con backend trusted e App Check abilitati, verificare la negazione cloud per account email verificato ma mai consentito, poi primo consenso esplicito e accesso cloud dopo reload. Provare guest→account senza trasferimento automatico del consenso ospite.
2. Sul runtime Production, solo con account di prova autorizzato e senza operazioni distruttive, ripetere il flusso di consenso già distribuito e annotare ciò che è effettivamente verificato: prima accettazione, revoca online, sospensione e nuova accettazione esplicita.
3. Esportare prima un backup JSON di prova. Passare offline, revocare il consenso, riaccettare esplicitamente solo sul dispositivo, modificare un dato sintetico, chiudere completamente l'app e riaprirla offline. Il dato deve sopravvivere nel vault, mentre la replica cloud deve restare sospesa.
4. Tornare online. Verificare la riconciliazione del consenso; se compare `recovery-required` per una revisione precedente, controllare che la scelta di recupero resti esplicita, con backup disponibile, e che un journal precedente la revoca non venga caricato senza autorizzazione.
5. Ripetere dopo sospensione/ripresa e su due schede o due dispositivi: un client obsoleto non deve ripristinare il consenso o sovrascrivere dati locali. Provare separatamente errori App Check, rete intermittente e cambio UID con account **di test**.

## Collaudi reali PWA non sostituibili dal browser simulato

Su Safari iOS normale e PWA installata, Chrome Android/PWA installata e desktop, quando disponibili: verificare avvio offline con dati guest di prova, chiusura del processo e riapertura, ripresa foreground dopo ore, rilevazione e applicazione di una nuova versione reale, barriera di reload in presenza di modifiche non durevoli, caching di app shell/shortcut, fusi orari e DST, tema chiaro/scuro e viewport stretti. Per l'aggiornamento reale occorrono due release controllate in ambiente Test. L'evento simulato `logbook:pwa-update-waiting` verifica solo la reazione del prompt.

## Isolamento Firebase Test

Prima dell'uso registrare e verificare project ID, Auth/Firestore, Rules/indici, App Check/reCAPTCHA, backend Admin e origin dedicati. Non riusare il progetto pubblico `logbook-db-98cc4`, `thelogbook.web.app` o `logbook-gnf.vercel.app` per test E2E con modifiche distruttive. Una suite autenticata futura dovrà essere separata e opt-in, eseguire un preflight che rifiuti ID/origin Production, limitare le credenziali di CI e cancellare soltanto le proprie fixture sintetiche. Non creare risorse a pagamento o ampliare il gate canonicale senza la relativa validazione.
