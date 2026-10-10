# Dati salute e revoca del consenso — decisione e gate pre-pilot

> Stato al 10 ottobre 2026: **SOLUZIONE A APPROVATA DAL PRODUCT OWNER**. Il codice candidato è nella [PR #301](https://github.com/gernotfound/logbook/pull/301), ancora in bozza e **non distribuita**. Le verifiche legali e Production restano aperte.
> Baseline `main` osservata per questa revisione documentale: `63039597b693aa88c16797890015c7873360a276` (10 ottobre 2026). I test sulla PR non dimostrano il comportamento Production.
> Questo documento non costituisce un parere legale, una DPIA conclusa o un'autorizzazione ad attivare la funzione.
> Non certifica configurazioni Firebase/Vercel/Sentry Production.

## Perché esiste

La PWA tratta dati di allenamento, alimentazione, misurazioni corporee, sonno e annotazioni sui dolori. Alcuni di questi dati, per contenuto e contesto, possono rientrare nell'art. 9 GDPR; non tutti i singoli valori fitness vanno automaticamente classificati come dati sanitari. Il prodotto oggi richiede un consenso esplicito separato, ma non offre un percorso completo e verificato per revocarlo. Una semplice nuova checkbox non risolverebbe il problema: il trattamento comprende stato in memoria, copie locali e sincronizzate, dispositivi offline e fornitori.

Le basi giuridiche di **ogni finalità** devono essere validate (art. 6 e, quando applicabile, art. 9 GDPR). La necessità dei dati per erogare singole funzioni, la libertà del consenso e le conseguenze della revoca non possono essere decise dalla sola architettura.

Fonti istituzionali da utilizzare nella revisione:
- GDPR, artt. 6, 7(3), 9, 13, 17 e 25: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- EDPB, Linee guida 05/2020 sul consenso: https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en
- Garante Privacy, principi fondamentali: https://garanteprivacy.it/web/guest/home/principi-fondamentali-del-trattamento
- Garante Privacy, dispositivi e app fitness tracker: https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9968193

## Stato osservato e confini tecnici

| Confine | Evidenza nel codice | Conseguenza |
|---|---|---|
| Tipi | `src/types.ts`: `LegalConsent` contiene `hasAcceptedTerms`, `hasAcceptedHealthData`, `acceptedAt`, versioni; nessuno stato dedicato di revoca | Un `false` storico o una versione vecchia non costituisce un protocollo distribuito di revoca |
| UI | `src/components/UI/ConsentOverlay.tsx`: accettazione esplicita salute, obbligatoria per proseguire; `src/components/Settings/PrivacySettingsTab.tsx`: toggle GA4 e link legali, non revoca salute | L'utente non ha un controllo di revoca equivalente in Impostazioni |
| Gate corrente | `src/lib/legalVersions.ts`: `needsLegalUpdate` richiede versioni correnti e due booleani veri | Impedisce l'accesso tramite overlay nei casi previsti, ma non costituisce revoca autorevole cross-device |
| Replica dati | `src/lib/sync/documentProjection.ts`: `legalConsent` è nel root; storico e nutrizione in `history_months` e `nutrition_months` | Stato e dati attraversano percorsi di persistenza diversi |
| Autorizzazioni | `firestore.rules`: proprietà UID e blocco account-deletion; `legalConsent` è ammesso come mappa nel root | Non è presente una barriera Rules per il consenso salute revocato che impedisca scritture da vecchi client |
| Offline | `src/lib/sync/localRepository.ts`, `src/lib/sync/deviceStorage.ts`, `src/contexts/AuthContext.tsx`, journal e hydration | Una modifica solo React o solo localStorage non blocca tutte le repliche o le tab/dispositivi obsoleti |
| Esportazione / eliminazione | `src/lib/db/backupSnapshot.ts`, `src/lib/backup.ts`, `src/lib/db/db_account.ts`, backend Vercel | Non confondere esportazione, revoca, limitazione e cancellazione account; le cancellazioni irreversibili richiedono conferma distinta |

Questa tabella rappresenta un'analisi dei confini, **non** un penetration test e **non** una verifica del runtime o di tutti i chiamanti.

## Decisione di prodotto approvata: soluzione A; verifiche giuridiche aperte

1. **DECISO — soluzione A:** proporre l'esportazione completa facoltativa **prima** di confermare la revoca; dopo la conferma, sospendere le funzioni di tracciamento e modifica dei dati salute, mantenendo soltanto informativa, esercizio dei diritti e cancellazione dell'account. Non introdurre la soluzione B (uso fitness limitato). Non promettere un export dopo la cancellazione; ogni eventuale conservazione residua richiede una diversa giustificazione e durata appropriata.
2. **Dati già conservati:** individuare per categoria ciò che va cancellato, ciò che può eventualmente restare su una diversa base valida, durata e modalità; valutare anche backend, cache locale, log e fornitori.
3. **Revoca offline:** definire quando la revoca diventa effettiva e come comunicare un eventuale stato pendente del cloud. Interrompere subito le operazioni locali dipendenti dal consenso; non dichiarare revocato sul cloud un trattamento finché non si è ottenuta prova della registrazione server.
4. **Re-consenso:** decidere se e come riattivare funzionalità senza reimportare/recreare dati cancellati, senza consentire a un altro dispositivo di sovrascrivere uno stato di revoca più recente.
5. **Ospite:** distinguere l'uso locale e la raccolta presso i fornitori; stabilire le modalità necessarie a esercitare i diritti nella modalità priva di account.
6. **Informativa e titolare:** correggere la descrizione della revoca, il canale di contatto e le basi giuridiche prima dei trattamenti per cui tali informazioni sono obbligatorie, non soltanto prima della vendita.

La scelta di prodotto prevede, **solo dopo conferma informata e futuro rilascio approvato**, la cancellazione dei dati di tracciamento privi di altra valida base giuridica, mantenendo l'account. Non autorizza cancellazioni di dati reali in questa fase né conservazione indefinita. La gestione dei dati residui deve essere validata sotto i profili degli artt. 6, 9 e 17 GDPR prima del rilascio.

## Comportamento UX approvato per la soluzione A

- **Da Impostazioni → Privacy:** azione distinguibile `Revoca il consenso per i dati salute` con spiegazione anticipata delle conseguenze. Confermare la volontà di revoca senza creare ostacoli sproporzionati; l'eliminazione dei dati e dell'account è un'azione diversa.
- **Dopo la revoca:** schermata di sospensione dedicata, senza dashboard, workout, diario o funzionalità che richiedano il consenso. Restano accessibili informativa, strumenti di esercizio dei diritti applicabili e procedura di eliminazione account. L'export completo facoltativo va proposto **prima** della conferma; non promettere export dei dati già cancellati. La schermata non può presentare `Accetta e continua` come scorciatoia per annullare la revoca.
- **Durante l'operazione:** bloccare subito le nuove modifiche/repliche dipendenti dal consenso. Distinguere visibilmente `revoca registrata`, `revoca in attesa di registrazione server` e `errore di registrazione`; mai comunicare un successo cloud non verificato.
- **Offline e più dispositivi:** registrare la richiesta localmente in modo durevole e fermare le operazioni locali interessate anche a riavvio e fra tab. Quando ritorna la rete, registrare/riconciliare in modo idempotente presso un confine autorevole del server, con difesa contro client obsoleti e richieste già in volo; nessuna operazione di scrittura precedentemente pendente deve ripristinare il trattamento revocato.
- **Esportazione e cancellazione:** proporre l'export facoltativo prima della conferma; dopo la conferma avviare, soltanto con funzione legalmente approvata, la cancellazione dei dati di tracciamento non altrimenti giustificati, senza cancellare l'account. Salvaguardare il separato percorso di account deletion/recovery; verificare la base giuridica e la durata di ogni residuo.
- **Riattivazione futura:** nessun re-consenso implicito da sessione vecchia, refresh, import/backup o modifica di `legalConsent` lato client. Un eventuale nuovo flusso di consenso esplicito va progettato e approvato separatamente.
- **Utenti ospiti:** la sospensione riguarda le funzioni che dipendono dal consenso anche senza account, ma non va equiparato lo storage solo locale all'invio cloud; verificare finalità e confini dei trattamenti.

## Vincoli giuridici non risolti

Secondo GDPR art. 7(3) e Linee guida EDPB 05/2020, la revoca deve essere facile quanto il consenso; cessano le operazioni fondate solo su quel consenso, **compresa l'ulteriore conservazione se non esiste altra base valida**. La soluzione A non può promettere dati esportabili per un periodo indefinito senza una base giuridica appropriata. Prima della modifica runtime, la revisione privacy deve definire chiaramente i trattamenti residui e i termini minimi strettamente necessari, le eccezioni legittime, la notifica ai fornitori applicabili e i testi rivolti all'utente.

## Invarianti richiesti a qualunque implementazione approvata

- Nessuna nuova operazione che dipende esclusivamente dal consenso ritirato può essere accettata o replicata dopo la revoca efficace; includere client/tab vecchi, richieste in volo, offline journal e backend con privilegi Admin.
- Le scelte non possono essere sovrascritte da snapshot stantii, merge guest→account, restore/import di backup, cambio dispositivo o autenticazione successiva.
- Distinguere rigorosamente stato locale `pending`, conferma autorevole server e failure; rifiutare il falso successo.
- Se la barriera server deve proteggere anche client obsoleti, implementarla in un confine verificabile dal server: il campo `UserData.legalConsent` è modificabile dal client e da solo non garantisce l'invariante.
- Revocare non deve cancellare silenziosamente dati, pending journal, ricevute di cancellazione o copie necessarie al recupero; qualsiasi purge va progettato e testato separatamente, coerentemente con la decisione giuridica.
- Informativa, documentazione di accountability, UI e comportamenti devono concordare. Se cambiano condizioni materiali, aggiornare `LEGAL_VERSIONS.privacy` e regressioni correlate.
- Non usare la revoca GA4 (`src/lib/analyticsConsent.ts`) come sostituto della revoca dei trattamenti salute: i due canali sono distinti.

## Regressioni CRITICAL da aggiungere **dopo** la decisione

1. Consenso con versione corretta vs assente/vecchio; rifiuto, revoca, ripresa e re-consenso, senza accesso improprio.
2. Revoca durante workout attivo, scrittura IndexedDB/journal, pending cloud write e lost acknowledgement.
3. Due tab e due dispositivi: una revoca non deve essere annullata da client obsoleti, offline o sessione riaperta.
4. Guest→account, logout→altro account, import/restore di backup con consenso precedente o snapshot vecchio.
5. Firestore Emulator: root, shard mensili e `sync_control` dopo revoca, inclusi test negativi; Admin API/cron verificati sul loro confine separato.
6. Errori di rete, storage non leggibile, token scaduto, App Check indisponibile, retry concorrenti e recovery.
7. Prova su browser/PWA iOS, Android e Desktop con temi/viewport pertinenti; test della accessibilità del flusso.
8. Nessun dato reale negli ambienti di test; `verify:m8` / CI canonica exact-SHA, review, merge, CI main e Production verificati separatamente.

## Gate di rilascio

**NON CHIUSO.** Prima del pilot con utenti reali:
- [ ] classificazione delle finalità e delle basi artt. 6/9 approvata da professionista competente;
- [x] decisione esplicita di prodotto: soluzione A (export facoltativo prima, poi sospensione, diritti e cancellazione account);
- [ ] specifica tecnica end-to-end per ospite, account, offline, multi-device e recovery;
- [ ] implementazione atomica/autorativa con test negativi e failure path;
- [ ] verifica Firestore Rules live, backend quando coinvolto e runtime PWA pertinente;
- [ ] informativa, registro, DPIA screening, retention e procedura diritti aggiornati e validati.

Rif.: `docs/compliance/data-subject-rights-procedure.md`, `docs/compliance/dpia-screening-template.md`, `docs/compliance/retention-schedule.md`, `docs/compliance/processing-record-template.md`, `.agents/rules/data-model-and-zod.md` e `.agents/rules/storage-and-sync.md`.
