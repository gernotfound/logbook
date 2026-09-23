# Accordo SaaS LogBook ↔ palestra — struttura per revisione legale

> Bozza strutturale, non pronta per la firma. Inserire dati reali soltanto nella fase contrattuale e far revisionare il testo da un professionista legale/commerciale.

## Parti

- Fornitore: `[PROVIDER_LEGAL_NAME]`, `[PROVIDER_LEGAL_FORM]`, `[PROVIDER_ADDRESS]`, `[TAX_DETAILS]`.
- Cliente/palestra: `[GYM_LEGAL_NAME]`, `[GYM_ADDRESS]`, `[GYM_TAX_DETAILS]`.

## 1. Oggetto

Il Fornitore rende disponibile LogBook secondo il modello concordato. Il rapporto economico è B2B ed esterno alla PWA; LogBook non gestisce il pagamento della palestra né il pagamento degli utenti.

## 2. Modello di distribuzione

Per il modello prodotto corrente:

- la palestra può comunicare agli iscritti il link o le modalità di accesso a LogBook;
- la palestra non riceve credenziali amministrative LogBook;
- la palestra non accede, consulta, modifica o esporta i dati LogBook degli utenti;
- l'utente gestisce direttamente il proprio eventuale account;
- non esiste obbligo tecnico di condividere dati LogBook con la palestra.

Qualunque futuro accesso gym/coach, dashboard, invito gestito, report o condivisione dati richiede modifica preventiva di prodotto, privacy e contratto.

## 3. Corrispettivo e fatturazione

- Canone/prezzo: `[FEE]`
- Periodicità: `[BILLING_CYCLE]`
- Fatturazione: `[INVOICING]`
- Imposte/IVA: `[TAX_HANDLING]`
- Pagamenti in-app: nessuno previsto.

## 4. Durata, rinnovo e recesso

- Durata: `[TERM]`
- Rinnovo: `[RENEWAL]`
- Preavviso/recesso: `[NOTICE_PERIOD]`
- Sospensione per violazioni/sicurezza: `[CLAUSE]`
- Effetti della cessazione: `[EFFECTS]`

## 5. Servizio e supporto

- Canale supporto: `[SUPPORT_EMAIL]`
- Orari: `[SUPPORT_HOURS]`
- Impegno: `[BEST_EFFORT / SLA]`
- Tempi di presa in carico: `[IF_PROMISED]`
- Manutenzione programmata: `[POLICY]`

Non promettere uptime, tempi di risposta, backup o restore che non siano realmente sostenibili, monitorati e documentati.

## 6. Obblighi della palestra

La palestra si impegna, nei limiti definiti professionalmente nel contratto, a:

- non presentare LogBook come servizio medico, diagnostico o prescrittivo;
- non richiedere agli utenti credenziali o accesso al loro account LogBook;
- rispettare il perimetro 18+ del pilot;
- non trasmettere al Fornitore dati personali degli iscritti oltre quanto necessario al rapporto commerciale;
- non dichiarare di avere accesso ai dati LogBook se tale accesso non esiste;
- informare il Fornitore prima di proporre flussi che comportino coach access, tenant gym, inviti nominativi, analytics per palestra o condivisione dati.

## 7. Proprietà intellettuale e licenza

Definire:

- titolarità del software e dei marchi;
- licenza concessa alla palestra per il periodo contrattuale;
- limiti di riproduzione/distribuzione;
- materiali promozionali;
- reverse engineering nei limiti consentiti dalla legge;
- gestione feedback e sviluppi personalizzati, se applicabili.

## 8. Privacy e ruoli

Il contratto deve riflettere il ruolo fattuale validato in `controller-role-decision.md`; non inserire automaticamente la qualifica di responsabile del trattamento.

- DPA Art. 28: `[REQUIRED / NOT_REQUIRED / TO_VALIDATE]`
- Accordo Art. 26: `[REQUIRED / NOT_REQUIRED / TO_VALIDATE]`
- Contatto privacy: `[PRIVACY_EMAIL]`
- Istruzioni privacy specifiche della palestra, se esistono: `[TEXT]`

## 9. Sicurezza e incidenti

Richiamare le misure tecniche e organizzative applicabili, i canali di escalation, la cooperazione ragionevole in caso di incidente e gli obblighi di non introdurre pratiche che aggirino i controlli di sicurezza.

## 10. Fornitori e subprocessori

Richiamare l'elenco applicabile e il meccanismo per comunicare cambiamenti quando richiesto dal ruolo privacy/contratto.

## 11. Dati, export e cessazione

Definire gli effetti della cessazione del rapporto B2B senza compromettere i diritti autonomi degli utenti LogBook. In particolare, la fine del contratto palestra non deve comportare automaticamente la cancellazione degli account utenti salvo base, informazione e procedura valide.

## 12. Disponibilità, backup e continuità

Descrivere la disponibilità realmente offerta, la natura offline-first, le funzioni di export/backup utente e l'eventuale policy di backup server. Distinguere recovery applicativo da garanzie di disaster recovery contrattuali.

## 13. Garanzie e limitazioni di responsabilità

Descrivere correttamente natura del servizio e assenza di consulenza medica. Responsabilità, indennizzi, massimali, esclusioni e garanzie inderogabili devono essere revisionati professionalmente.

## 14. Modifiche al servizio

Definire:

- aggiornamenti tecnici e di sicurezza;
- modifiche materiali;
- eventuali preavvisi;
- cambiamenti legali/privacy;
- fine vita o cessazione del servizio.

## 15. Legge applicabile e foro

- Legge applicabile: `[GOVERNING_LAW]`
- Foro/risoluzione controversie: `[JURISDICTION]`

Da validare in relazione alle parti e alla normativa inderogabile applicabile.

## Allegati suggeriti

A. Descrizione del servizio
B. Corrispettivo, durata e fatturazione
C. Support/SLA
D. Security/TOM sheet
E. Privacy role decision
F. DPA Art. 28, solo se applicabile
G. Subprocessor/vendor schedule
H. Exit/deletion policy
