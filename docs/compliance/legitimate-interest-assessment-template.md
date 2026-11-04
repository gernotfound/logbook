# LIA — modello condizionale, trattamento non attivo

> Il monitoraggio automatico degli errori client è ritirato. Questo modello non descrive un trattamento attualmente attivo: usarlo soltanto se una futura finalità richiederà un'autonoma valutazione dell'Art. 6(1)(f) GDPR.

Per verificare l'assenza del monitoraggio esterno usare [Telemetria e privacy](../../.agents/rules/telemetry-and-privacy.md). Le restanti voci sono uno schema storico/condizionale e richiedono una riscrittura prima di qualunque nuova integrazione.

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

Se un evento non supera il test di necessità, non raccoglierlo o rimuoverlo. Non trasformare la telemetria tecnica in analytics comportamentali.

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
- distinguere messaggi/stack sanitizzati nella coda locale dalle sole classificazioni e messaggi fissi inviati a Sentry; nessun testo/stack originale al provider, anche se troncato o sanitizzato;
- allowlist dettagli evento;
- nessun testo business libero intenzionale;
- coda locale cifrata owner-scoped, senza upload dei report guest dopo cambio identità; nessun accesso client alle collection Firestore telemetriche ritirate;
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
