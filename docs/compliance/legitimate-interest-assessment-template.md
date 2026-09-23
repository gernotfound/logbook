# LIA — telemetria tecnica LogBook

> Template di Legitimate Interests Assessment. Compilare e far validare se la telemetria tecnica continua a basarsi sull'Art. 6(1)(f) GDPR.

## 1. Interesse perseguito

- Interesse: sicurezza, affidabilità, diagnosi degli errori, integrità e recovery del servizio.
- Beneficiario: `[PROVIDER / USERS / BOTH]`.
- Necessità operativa: `[TEXT]`.
- Conseguenze dell'assenza di telemetria: `[TEXT]`.

L'interesse non deve essere descritto genericamente come "analytics": il perimetro corrente esclude tracking proprietario dell'avvio/salvataggio workout e del funnel di installazione PWA.

## 2. Test di necessità

| Domanda | Risposta |
|---|---|
| Il trattamento contribuisce realmente alla finalità? | `[YES/NO + EVIDENCE]` |
| Esiste un mezzo meno invasivo che fornisca informazione sufficiente? | `[ASSESS]` |
| Tutti i campi raccolti sono necessari? | `[ASSESS]` |
| La retention è la minima ragionevole? | `[ASSESS]` |
| Si può usare dato aggregato/non identificato invece di UID/session ID? | `[ASSESS]` |
| L'evento è diagnostico e non comportamentale? | `[YES/NO]` |

Se un evento non supera il test di necessità, rimuoverlo o spostarlo nel flusso analytics soggetto a consenso, se davvero necessario.

## 3. Bilanciamento

Valutare:

- ragionevoli aspettative dell'utente;
- natura dei dati e possibilità che un errore contenga accidentalmente dati personali;
- presenza di UID/session ID e quindi pseudonimizzazione, non anonimato;
- categorie particolari che potrebbero comparire accidentalmente nel testo;
- quantità e frequenza;
- impatto di accesso improprio;
- possibilità di opposizione;
- retention;
- misure di sicurezza/minimizzazione.

## 4. Misure di salvaguardia

- sanitizzazione email, IP, token, API key e path riconosciuti;
- stack troncati;
- allowlist dettagli evento;
- nessun testo business libero intenzionale;
- collection owner-scoped;
- queue offline bounded;
- retention breve `[TARGET]` con enforcement da verificare;
- accesso amministrativo limitato;
- processo di opposizione `[DEFINE]`;
- review periodica dei nuovi eventi.

## 5. Esito

- Interesse legittimo sufficientemente specifico: `[YES/NO]`
- Necessità dimostrata: `[YES/NO]`
- Bilanciamento favorevole con salvaguardie: `[YES/NO]`
- Trattamento approvato: `[YES/NO]`
- Modifiche richieste: `[TEXT]`
- Data: `[DATE]`
- Approvazione: `[ROLE]`
- Revisione: `[DATE/TRIGGER]`
