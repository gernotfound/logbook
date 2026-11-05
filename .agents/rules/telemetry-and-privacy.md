# Gestione errori e privacy tecnica — TheLogBook

**Quando leggere:** error handling, fallback Zod, controlli di storage, possibili report esterni e rimozione di servizi diagnostici.
**Non inferire:** il ritiro dell'SDK di monitoraggio errori non elimina i log tecnici generati dai servizi Firebase e Vercel per le richieste necessarie all'app.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto specializza i suoi invarianti senza ampliare autorizzazioni.

## Nessuna raccolta automatica esterna degli errori client

**MUST:** il frontend non include SDK o trasporti di Error Monitoring di terze parti, né invia errori React/JavaScript, messaggi, stack, identificativi di sessione o anomalie locali a servizi diagnostici esterni. Non implementare tracker, replay di sessione, tracing, analytics comportamentali, code diagnostiche persistenti, invio differito o upload automatico di source map.

- `src/main.tsx` non registra listener globali destinati alla telemetria e usa il normale root React.
- `src/components/UI/ErrorBoundary.tsx` mantiene le schermate di errore e i percorsi di recupero sicuro: rimuovere il monitoraggio **non** consente reset, reload, commit o purge che violano il contratto storage.
- `src/lib/storageIntegrity.ts` conserva soltanto i marker e la classificazione locale dello stato di IndexedDB; nessuna anomalìa viene inviata all'esterno.
- `src/lib/errorHandler.ts` conserva il mapping dei codici Firebase per l'interfaccia.
- I fallback Zod mantengono la logica di validazione e recupero prevista dagli schemi, senza callback o emissioni diagnostiche.

**MUST:** `firebase.json` non autorizza endpoint esterni di monitoraggio degli errori in `connect-src`; il workflow Firebase Hosting non richiede DSN, token, organization/project o upload di source map. `scripts/check-production-build-secrets.mjs` impedisce la reintroduzione accidentale di variabili di monitoraggio nel workflow.

## Servizi tecnici necessari

Firebase Hosting, Authentication, Firestore, App Check e le API Vercel restano operativi e possono elaborare metadati di rete e log tecnici necessari al servizio. La documentazione legale li distingue dall'assenza di reporting automatico degli errori client.

Il client non scrive raccolte diagnostiche e il backend non ha più processi di retention dedicati a diagnostica pre-lancio. Le Security Rules negano per impostazione predefinita gli accessi a raccolte non previste. Cancellazione account, erasure dei dati salute, isolamento owner e verifica fail-closed delle sottoraccolte inattese restano invariati.

## Verifica e conformità

- Cercare import dei pacchetti di monitoraggio, variabili di build, chiamate outbound, code residue, CSP, test/fixture e riferimenti documentali.
- Mantenere regressioni per marker, blocco dell'avvio non sicuro, errore React e fallimenti di salvataggio/sync, anche se il precedente test includeva uno spy del trasporto esterno.
- Le modifiche materiali dell'informativa incrementano `LEGAL_VERSIONS.privacy`, indipendente dalla versione della PWA.
- I valori/configurazioni eventualmente presenti in GitHub o nel vecchio provider non dimostrano che il client li usi; la cancellazione dei dati storici e la chiusura del provider richiedono verifica separata.

Collegamenti: [Servizi esterni](external-services.md), [Verifica CI](ci-verification.md), [Storage e sync](storage-and-sync.md), [Registro servizi](../../docs/operations/external-services-register.md).
