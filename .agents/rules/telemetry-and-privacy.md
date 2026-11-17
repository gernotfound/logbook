# Analytics Cloudflare, gestione errori e privacy tecnica — TheLogBook

**Quando leggere:** analytics di Cloudflare, metriche di prestazione/traffico, error handling, fallback Zod, storage, diagnostica e privacy.
**Non inferire:** il ritiro dell'SDK di monitoraggio errori non elimina i log tecnici generati dai servizi Firebase e Vercel per le richieste necessarie all'app.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto specializza i suoi invarianti senza ampliare autorizzazioni.

## Nessuna raccolta automatica esterna degli errori client

**MUST:** il frontend non include SDK o trasporti di Error Monitoring di terze parti, né invia errori React/JavaScript, messaggi, stack, identificativi di sessione o anomalie locali a servizi diagnostici esterni. Non implementare session replay, profilazione individuale, tracing con dati sensibili, code diagnostiche persistenti, invio differito degli errori o upload automatico di source map. Questo divieto **non** riguarda le statistiche aggregate di Cloudflare Web Analytics approvate nel contratto seguente.

- `src/main.tsx` non registra listener globali destinati alla telemetria e usa il normale root React.
- `src/components/UI/ErrorBoundary.tsx` mantiene le schermate di errore e i percorsi di recupero sicuro: rimuovere il monitoraggio **non** consente reset, reload, commit o purge che violano il contratto storage.
- `src/lib/storageIntegrity.ts` conserva soltanto i marker e la classificazione locale dello stato di IndexedDB; nessuna anomalìa viene inviata all'esterno.
- `src/lib/sync/syncFailure.ts` classifica gli esiti sync; i consumer di `dispatchDurableOperation` non trasformano una rejection in conferma di salvataggio attraverso messaggi o codici dell'errore.
- I fallback Zod mantengono la logica di validazione e recupero prevista dagli schemi, senza callback o emissioni diagnostiche.

**MUST:** `firebase.json` non autorizza endpoint esterni di monitoraggio degli errori in `connect-src`; il workflow Firebase Hosting non richiede DSN, token, organization/project o upload di source map. `scripts/check-production-build-secrets.mjs` impedisce la reintroduzione accidentale di variabili di monitoraggio nel workflow.

## Cloudflare Web Analytics Free — autorizzazione di prodotto, implementazione futura

**MUST (decisione 17/11/2026):** l'utilizzo futuro di **Cloudflare Web Analytics Free** è autorizzato per statistiche aggregate di visite, traffico e prestazioni reali (ad esempio Core Web Vitals, browser e dispositivi) utili alla progettazione di TheLogBook. Il divieto assoluto di analytics non è più vigente. Questo aggiornamento **non installa né attiva** il beacon: l'implementazione è rimandata alla [issue #1202](https://github.com/gernotfound/logbook/issues/1202). Cloudflare Web Analytics non offre eventi applicativi personalizzati: pageview della SPA non equivalgono a misure d'uso delle singole funzioni fitness.

**MUST (integrità del rilascio):** il frontend non deve ricevere l'iniezione **automatica dal provider** di script Web Analytics/RUM nell'HTML. L'audit del 14/11/2026 ha osservato che `auto_install=true` e RUM attivo alteravano i byte di `/?tab=training`; sono stati impostati `auto_install=false`, ruleset `enabled=false` e `rum=manual`. Questa configurazione vieta la modifica HTML non revisionata, **non la futura integrazione manuale approvata**; il dato live va riletto prima di ogni attivazione. Non eliminare il sito Analytics storico senza inventario e mandato separato.

**MUST:** i deploy confrontano HTML pubblico e scorciatoie PWA con gli asset esatti costruiti su `main`; uno script **iniettato dall'edge e non presente negli asset revisionati**, anche se bloccato dalla CSP, è un errore di integrità e privacy. Un'eventuale integrazione manuale è ammissibile solo se autorizzata nel codice e supera i medesimi smoke. Non disabilitare né allentare i controlli per rendere verde la CI. In caso di difformità, verificare la configurazione RUM/auto-install e le trasformazioni edge prima di ipotizzare cache obsolete.

## Condizioni per il futuro inserimento

- **Privacy:** non inviare dati sanitari, misure, allenamenti, nutrizione, UID, email, token OAuth, identificatori di sessione, URL con parametri sensibili, contenuti dei form o delle schermate. Non usare analytics per profilazione individuale. I log tecnici obbligatori dei provider rimangono distinti dalle statistiche Web Analytics.
- **Confine SPA:** la PWA può mostrare contenuti salute nello stesso documento della pagina iniziale; la sola allowlist di URL al caricamento non prova che uno script remoto sia isolato quando React cambia schermata. Verificare il modello di esecuzione, l'effettivo payload RUM, referrer/URL di risorse e Safari/iOS prima di abilitare la raccolta.
- **Piano Free:** non attivare prodotti a pagamento, nuovi abbonamenti o billing. Verificare le quote e la disponibilità sul provider al momento dell'integrazione.
- **Conformità e rilascio:** aggiornare entrambe le informative solo insieme alla funzione reale, valutare basi giuridiche e possibile consenso specifico per analytics, separandolo dal consenso esplicito per i dati salute. Allineare le versioni legali ai backend effettivi prima del deploy. Test, CI exact-SHA, provider live, browser e dashboard sono prove separate; nessun GO implicito dalla sola autorizzazione nel contesto.

## Servizi tecnici necessari

Firebase Authentication, Firestore e App Check rimangono dipendenze del codice legacy; Hosting Firebase è disabilitato e il backend Vercel risulta sospeso. Kinde e Cloudflare possono trattare metadati tecnici per il servizio, da verificare con contratti e impostazioni live. Nessun SDK di Error Monitoring client esterno deve essere aggiunto; un futuro beacon Cloudflare Analytics resta soggetto alle condizioni sopra e non è attivato da questa revisione.

Il client non scrive raccolte diagnostiche e il backend non ha più processi di retention dedicati a diagnostica pre-lancio. Le Security Rules negano per impostazione predefinita gli accessi a raccolte non previste. Cancellazione account, erasure dei dati salute, isolamento owner e verifica fail-closed delle sottoraccolte inattese restano invariati.

## Verifica e conformità

- Cercare import dei pacchetti di monitoraggio, variabili di build, chiamate outbound, code residue, CSP, test/fixture e riferimenti documentali.
- Mantenere regressioni per marker, blocco dell'avvio non sicuro, errore React e fallimenti di salvataggio/sync, anche se il precedente test includeva uno spy del trasporto esterno.
- Le modifiche materiali dell'informativa incrementano `LEGAL_VERSIONS.privacy`, indipendente dalla versione della PWA.
- I valori/configurazioni eventualmente presenti in GitHub o nel vecchio provider non dimostrano che il client li usi; la cancellazione dei dati storici e la chiusura del provider richiedono verifica separata.

Collegamenti: [Servizi esterni](external-services.md), [Verifica CI](ci-verification.md), [Storage e sync](storage-and-sync.md), [Registro servizi](../../docs/operations/external-services-register.md).
