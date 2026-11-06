# Procedura diritti interessati — TheLogBook

> Procedura interna. Il canale privacy è indicato sotto; prima dell'apertura a terzi organizzare il monitoraggio e mantenere la procedura coerente con le capacità tecniche effettive.

## Canali

- Privacy: `thelogbook.privacy@gmail.com` (recapito dichiarato, funzionamento confermato dal product owner il 5 novembre 2026; organizzare controllo periodico della casella e registrazione delle richieste)
- Supporto: `[SUPPORT_EMAIL]`
- Capacità tecniche in app: backup JSON/esportazioni, rettifica, revoca/riaccettazione del consenso, cancellazione automatica dei dati applicativi dopo revoca trusted, distinta dalla cancellazione dell'identità account. Per contratti e limiti usare [Consenso](../../.agents/rules/health-consent.md), [Ciclo account](../../.agents/rules/account-lifecycle.md) e [Portabilità](../../.agents/rules/backup-and-portability.md); questa procedura non certifica collaudi live.

## Decisione operativa aggiornata — 6 novembre 2026

Alla revoca del consenso salute (account), le funzioni fitness sono sospese subito; il backend trusted **accoda automaticamente la cancellazione dei dati applicativi quando la revoca viene confermata**, senza eliminare l'identità Firebase Auth. Il backup JSON è offerto prima della revoca ed è **facoltativo**: una mancata esportazione non blocca la revoca. Il worker registra stati `requested/deleting/verifying/failed/complete`; solo un `complete` con prova dell'epoch autorizza la pulizia locale. Per revoche offline, distinguere stato locale pending e registrazione server. La modalità ospite purga l'archivio locale e termina la sessione. L'account deletion rimane una richiesta distinta.

Le precedenti note sulla cancellazione **solo su richiesta separata** sono storiche e non descrivono il nuovo flusso approvato. Restano verifiche legali/provider aperte per la conservazione delle prove tecniche e le copie non direttamente controllabili dal client.

## Apertura del caso

Assegnare un identificativo `DSR-[YYYY]-[NNN]` e registrare soltanto quanto necessario:

- data e ora di ricezione;
- diritto richiesto;
- canale di ricezione;
- account o identità interessata;
- verifica dell'identità proporzionata al rischio;
- sistemi da interrogare;
- termine di risposta;
- azioni eseguite;
- risposta ed esito;
- eventuale motivo di limitazione o rifiuto.

Non richiedere più dati identificativi di quanto necessario a verificare il richiedente.

## Tempi

Usare come riferimento l'Art. 12 GDPR: risposta senza ingiustificato ritardo e, in generale, entro un mese dalla richiesta. Eventuali proroghe sono ammesse soltanto alle condizioni previste dalla normativa e devono essere comunicate con relativa motivazione.

## Mappatura diritto → capacità

| Diritto | Capacità/procedura corrente |
|---|---|
| Accesso | Informazioni sul trattamento + raccolta dei dati applicabili; usare export quando adeguato alla richiesta concreta |
| Rettifica | Funzioni di modifica in app; intervento documentato se un dato non è editabile direttamente |
| Cancellazione | La revoca trusted avvia automaticamente la cancellazione dei dati applicativi mantenendo Firebase Auth; `Elimina account` è distinto. Verificare il job corretto, l'epoch, la chiave cloud e il cleanup locale autorizzato; considerare copie provider e file esportati |
| Portabilità | Backup JSON / export CSV; verificare che il formato copra il perimetro richiesto |
| Limitazione | `[DEFINE_IF_REQUIRED]`; non esiste oggi un flag generico di restriction |
| Opposizione | Valutare i trattamenti effettivamente basati sul legittimo interesse, inclusi eventuali log tecnici dei fornitori se questa è la base giuridica applicabile; non presumere un servizio di telemetria applicativa |
| Revoca consenso dati salute | Blocco immediato fitness; esportazione JSON facoltativa **prima** della conferma, erasure automatica al trusted withdraw (PR #826), senza eliminare Auth. Pending offline non equivale a successo server; re-consenso solo dopo job completo e archivio vuoto. Collaudo multi-device e validazione legale restano aperti |
| Reclamo | Informare del diritto di rivolgersi all'autorità di controllo competente |

## Gestione della revoca e richieste successive — issue #824

**Comportamento del repository:** la revoca sospende immediatamente il fitness. Se online, il backend registra la revoca e accoda il job di erasure **nella stessa transazione**; in assenza di rete lo stato locale è pending finché non avviene la riconciliazione trusted. La cancellazione riguarda archivi applicativi e chiave cloud, **non** Firebase Authentication. Il guest elimina i dati locali e termina la sessione. Il vecchio percorso di cancellazione solo dopo un secondo clic e la riaccettazione offline di archivi precedenti sono superati dalle PR #826/#829.

L'utente può esportare facoltativamente i dati **prima della revoca**; la scelta di non esportare non la impedisce. Durante un job attivo non è garantita l'esportazione cloud completa: non tentare di ignorare i guard di cancellazione e non presentare copie parziali come complete. Gestire eventuali domande di accesso o portabilità successive sulla base dei dati realmente esistenti, delle copie disponibili e degli obblighi applicabili; motivare l'eventuale impossibilità con risposta individuale, non con un presunto diritto di retention indefinita.

**Verifica del completamento:** distinguere local pending, revoca trusted e job `requested/deleting/verifying/failed/complete`. Prima di affermare la cancellazione, controllare ricevuta `complete`, epoch/revisione coerenti, chiave cloud eliminata, sottoraccolte previste e residui inattesi, pulizia owner-scoped locale; verificare separatamente l'eventuale copia provider e i limiti dei dispositivi offline. Un job fallito o una copia non verificata devono essere dichiarati come tali. La cancellazione dell'identità Auth richiede la procedura account deletion separata.

**Resta aperto prima di utenti esterni:** determinare per finalità basi giuridiche artt. 6 e 9, libertà del consenso, conservazione e accessi dei marker/receipt/Auth/log/case file, procedure presso i fornitori e trasferimenti. Il codice e le regressioni non sostituiscono collaudi autenticati multi-dispositivo né parere professionale. Vedi [gate di consenso](health-consent-release-gate.md), [retention](retention-schedule.md) e [registro fornitori](vendor-transfer-register.md).

## Flusso operativo

1. Ricevere e classificare la richiesta.
2. Verificare l'identità in modo proporzionato.
3. Identificare tutti i sistemi pertinenti: dispositivo, Firestore/Auth, eventuali log tecnici presso i fornitori e case file; non attribuire alla PWA code diagnostiche applicative non più presenti.
4. Eseguire le azioni consentite dagli strumenti correnti.
5. Se un sistema richiede un intervento manuale, registrare chi lo ha eseguito e l'evidenza minima.
6. Controllare che l'esito sia coerente su tutti i sistemi interessati.
7. Rispondere in linguaggio chiaro indicando cosa è stato fatto, eventuali eccezioni e i relativi motivi.
8. Chiudere il caso soltanto dopo verifica dell'esito.

## Chiusura del caso

Prima della chiusura:

- `[ ]` tutti i sistemi pertinenti sono stati considerati;
- `[ ]` le evidenze conservate sono minimizzate;
- `[ ]` eventuali dati non cancellati sono indicati con motivazione e durata;
- `[ ]` la risposta finale è stata inviata;
- `[ ]` eventuali gap sistemici emersi hanno una remediation assegnata;
- `[ ]` RoPA, DPIA, retention o informativa sono stati aggiornati se la richiesta ha evidenziato un cambiamento necessario.
