# Procedura diritti interessati — LogBook

> Procedura interna. Definire il canale privacy reale prima del pilot e mantenerla coerente con le capacità tecniche effettive.

## Canali

- Privacy: `[PRIVACY_EMAIL]`
- Supporto: `[SUPPORT_EMAIL]`
- Capacità già disponibili in app: backup JSON/esportazioni, rettifica dei dati editabili, account deletion, revoca Analytics.

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
| Cancellazione | Workflow server-mediated `Elimina account`; verificare completion cloud e successivo cleanup locale |
| Portabilità | Backup JSON / export CSV; verificare che il formato copra il perimetro richiesto |
| Limitazione | `[DEFINE_IF_REQUIRED]`; non esiste oggi un flag generico di restriction |
| Opposizione | Valutare per i trattamenti basati sul legittimo interesse, inclusa telemetria tecnica |
| Revoca Analytics | Impostazioni; effetto per il futuro |
| Revoca consenso dati salute | **Blocker di prodotto/privacy: flusso da decidere, implementare e testare** |
| Reclamo | Informare del diritto di rivolgersi all'autorità di controllo competente |

## Revoca consenso dati salute — blocker

L'utente deve poter revocare il consenso in modo effettivo. Prima del pilot serve una decisione di prodotto, validata sul piano legale/privacy, che definisca almeno:

1. da quale momento cessano i trattamenti che dipendono dal consenso Art. 9;
2. quali funzionalità restano disponibili senza dati salute;
3. quali dati già raccolti vengono cancellati, conservati o resi non utilizzabili e su quale eventuale base residua;
4. rapporto tra revoca, export e cancellazione account;
5. comportamento offline e sincronizzazione multi-dispositivo;
6. gestione di una revoca effettuata mentre esistono modifiche locali pendenti;
7. testo UI che non presenti il consenso come irrevocabile o artificiosamente obbligatorio.

Non descrivere questo diritto come pienamente implementato finché il relativo comportamento non è definito e coperto da regressioni.

## Flusso operativo

1. Ricevere e classificare la richiesta.
2. Verificare l'identità in modo proporzionato.
3. Identificare tutti i sistemi pertinenti: dispositivo, Firestore/Auth, telemetria, eventuali log/provider e case file.
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
