# Analytics, gestione errori e privacy tecnica — TheLogBook

**Quando leggere:** Cloudflare Web Analytics, metriche di esperienza/traffico, error handling, fallback Zod, storage, eventuali diagnostiche e privacy.
**Non inferire:** il ritiro dell'SDK di monitoraggio errori non elimina i log tecnici generati dai servizi Firebase e Vercel per le richieste necessarie all'app.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto specializza i suoi invarianti senza ampliare autorizzazioni.

## Nessuna raccolta automatica esterna degli errori client

**MUST:** il frontend non include SDK o trasporti di Error Monitoring di terze parti, né invia errori React/JavaScript, messaggi, stack, identificativi di sessione o anomalie locali a servizi diagnostici esterni. Non implementare tracciamento individuale o profilazione, session replay, tracing di dati utente, code diagnostiche persistenti, invio differito di errori o upload automatico di source map. Le metriche aggregate autorizzate di Cloudflare Web Analytics sono disciplinate separatamente qui sotto: non ricadono nel vecchio divieto generale di analytics.

- `src/main.tsx` non registra listener globali destinati alla telemetria e usa il normale root React.
- `src/components/UI/ErrorBoundary.tsx` mantiene le schermate di errore e i percorsi di recupero sicuro: rimuovere il monitoraggio **non** consente reset, reload, commit o purge che violano il contratto storage.
- `src/lib/storageIntegrity.ts` conserva soltanto i marker e la classificazione locale dello stato di IndexedDB; nessuna anomalìa viene inviata all'esterno.
- `src/lib/sync/syncFailure.ts` classifica gli esiti sync; i consumer di `dispatchDurableOperation` non trasformano una rejection in conferma di salvataggio attraverso messaggi o codici dell'errore.
- I fallback Zod mantengono la logica di validazione e recupero prevista dagli schemi, senza callback o emissioni diagnostiche.

**MUST:** `firebase.json` non autorizza endpoint esterni di monitoraggio degli errori in `connect-src`; il workflow Firebase Hosting non richiede DSN, token, organization/project o upload di source map. `scripts/check-production-build-secrets.mjs` impedisce la reintroduzione accidentale di variabili di monitoraggio nel workflow.

## Frontend Cloudflare: Web Analytics manuale, senza iniezione edge

**MUST:** Cloudflare Web Analytics Free è approvato come strumento ordinario di misurazione statistica e miglioramento UX, **non** come eccezione provvisoria da rimuovere dopo la migrazione. Il frontend su `thelogbook.me` non deve ricevere script Web Analytics/RUM tramite inserimento automatico del provider. Il loader manuale `public/analytics-loader.js` è autorizzato soltanto su `/` e `/index.html`, senza query, frammenti o referrer sensibili, rispettando DNT/GPC; non viene caricato nelle pagine legali, diagnostiche o OAuth. Questo perimetro descrive il **codice candidato**, non un'attivazione live già verificata. La Free tier non consente regole Web Analytics per singolo percorso: l'esclusione va applicata e testata nel client. Non introdurre error monitoring, identificatori account/sessione, dati sanitari o contenuti dei form. L'audit del 14/11/2026 ha verificato che `auto_install=true` e RUM attivo alteravano le risposte HTML: `/?tab=training` riceveva 4004 byte invece dei 3637 byte della build. Sono stati impostati `auto_install=false` e il ruleset Web Analytics `enabled=false`; il provider espone la modalità zona `rum=manual`, che **non** significa raccolta attiva quando nessuno snippet manuale è presente. Non eliminare il sito Analytics storico senza inventario e mandato separato. La modalità manuale deve rimanere attiva: non abilitare l'iniezione automatica che altera l'HTML dopo il build.

**MUST:** i deploy confrontano il contenuto dell'HTML pubblico e delle scorciatoie PWA con l'asset esatto costruito su `main`; un beacon iniettato **dall'edge**, anche se bloccato dalla CSP, è un errore di privacy e integrità del rilascio. Il beacon esplicitamente caricato dal bundle revisionato non deve modificare i byte dell'HTML servito. Non disabilitare né allentare lo smoke per rendere verde la CI. In caso di difformità, verificare configurazione RUM/auto-install e trasformazioni edge sul provider prima di ipotizzare una cache obsoleta; i purge URL non hanno risolto questo incidente.

## Finalità approvate e limiti delle metriche

- **Progettazione e prestazioni:** usare pageview e dimensioni aggregate (pagine pubbliche consentite, browser, sistema operativo, dispositivo, paese approssimato e provenienza quando disponibile), caricamento e Core Web Vitals quali LCP, INP e CLS. Analizzare risultati aggregati, non attribuire visite a persone né estrarre inferenze sanitarie.
- **Distinzione di prodotto:** Web Analytics non supporta eventi personalizzati (FAQ ufficiale aggiornata al 2026). La PWA usa schede React sullo stesso URL: visitare `/` non prova l'uso di Allenamento, Nutrizione o Dati. Non chiamare quelle metriche «utilizzo delle funzioni»; un futuro monitoraggio funzionale richiede un progetto separato con eventi a vocabolario fisso, verifiche privacy e quote, senza contenuti o identità.
- **Minimizzazione:** niente query string, frammenti, URL di callback, cookie, identificatori persistenti, payload sanitari, nomi di esercizi, misure, calorie, contenuti delle schermate, email, UID, token o session replay. Il beacon standard usa Performance API senza leggere IndexedDB o archivi salute. Un browser/servizio di rete può comunque trattare metadati tecnici della connessione: non garantire assenza assoluta di dati personali.
- **Origini e integrità:** `script-src https://static.cloudflareinsights.com`; per l'inclusione manuale, `connect-src https://cloudflareinsights.com`. Mantenere `auto_install=false`, `rum=manual`, ruleset disabilitato e lo smoke byte-identico; il test del beacon non deve autorizzare iniezione di HTML dal provider.
- **Fattibilità:** il dashboard Web Analytics dichiara accessibilità alle metriche per sei mesi e dati senza campionamento per sette giorni, poi aggregazione/campionamento. Ad-blocker, DNT/GPC, policy di raccolta per regione, perdita del beacon e Safari rendono le statistiche non esaustive: verificare dati effettivi prima di ottimizzare e non dedurre numeri utenti unici da pageview.
- **Separazione dei prodotti:** analytics HTTP/traffico edge e Workers Observability possono aiutare a leggere errori, richieste e consumo quote, ma non sono sinonimi di Web Analytics e non autorizzano la raccolta in chiaro di token, URL sensibili o payload sanitari nei log. Verificare disponibilità e costi Free di ogni prodotto separatamente.
- **Privacy e consenso:** `public/privacy.html` e `src/pages/PrivacyPolicy.tsx` devono descrivere lo stesso trattamento e distinguere le statistiche dal consenso salute ex art. 9. Basi giuridiche, eventuale esenzione dal consenso per gli analytics, contratti/subfornitori, conservazione e trasferimenti richiedono verifica giuridica e provider prima del GO. `LEGAL_VERSIONS.privacy` è già 1.3.10 nel candidato non pubblicato: non introdurre un secondo bump per la stessa revisione.

Fonti ufficiali: [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/about/), [FAQ/limiti e assenza di eventi personalizzati](https://developers.cloudflare.com/web-analytics/faq/), [RUM/privacy](https://developers.cloudflare.com/speed/observatory/rum-beacon/), [Garante, linee guida cookie e tracciamento](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876).

## Servizi tecnici necessari

Firebase Authentication, Firestore e App Check rimangono dipendenze del codice legacy; Hosting Firebase è disabilitato e il backend Vercel risulta sospeso. Kinde e Cloudflare possono trattare metadati tecnici per il servizio, da verificare con contratti e impostazioni live. Nessun SDK di telemetria client esterno deve essere aggiunto.

Il client non scrive raccolte diagnostiche e il backend non ha più processi di retention dedicati a diagnostica pre-lancio. Le Security Rules negano per impostazione predefinita gli accessi a raccolte non previste. Cancellazione account, erasure dei dati salute, isolamento owner e verifica fail-closed delle sottoraccolte inattese restano invariati.

## Verifica e conformità

- Cercare import dei pacchetti di monitoraggio, variabili di build, chiamate outbound, code residue, CSP, test/fixture e riferimenti documentali.
- Mantenere regressioni per marker, blocco dell'avvio non sicuro, errore React e fallimenti di salvataggio/sync, anche se il precedente test includeva uno spy del trasporto esterno.
- Le modifiche materiali dell'informativa incrementano `LEGAL_VERSIONS.privacy`, indipendente dalla versione della PWA.
- I valori/configurazioni eventualmente presenti in GitHub o nel vecchio provider non dimostrano che il client li usi; la cancellazione dei dati storici e la chiusura del provider richiedono verifica separata.

Collegamenti: [Servizi esterni](external-services.md), [Verifica CI](ci-verification.md), [Storage e sync](storage-and-sync.md), [Registro servizi](../../docs/operations/external-services-register.md).
