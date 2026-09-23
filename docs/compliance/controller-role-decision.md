# Decisione sui ruoli privacy — provider LogBook e palestra

> Documento di accountability. I ruoli GDPR dipendono dai fatti, non dall'etichetta contrattuale. Validare con un professionista prima della firma.

## Modello prodotto attuale

- Il pagamento palestra → provider avviene fuori dalla PWA.
- La palestra può distribuire il link/servizio ai propri iscritti.
- La palestra non ha un tenant LogBook, non ha account coach/admin e non vede i dati degli utenti.
- L'utente inserisce direttamente i propri dati in LogBook.
- Non esiste attualmente una funzione di reporting dell'utente verso la palestra.

## Domande decisive

| Domanda | Risposta | Evidenza |
|---|---|---|
| Chi decide le finalità del trattamento dentro LogBook? | `[TO_VALIDATE]` | `[CONTRACT / PRODUCT FACTS]` |
| Chi decide gli elementi essenziali dei mezzi di trattamento? | `[TO_VALIDATE]` | Architettura/contratto |
| La palestra impartisce istruzioni al provider su dati personali LogBook? | `[YES/NO]` | `[EVIDENCE]` |
| Il provider tratta dati LogBook per finalità proprie di erogazione/sicurezza? | `[YES/NO]` | `[EVIDENCE]` |
| La palestra riceve dati o report LogBook? | Attualmente: no | Codice/prodotto |
| La palestra può cercare o amministrare utenti LogBook? | Attualmente: no | Codice/prodotto |
| Esiste una finalità congiuntamente determinata? | `[TO_VALIDATE]` | `[EVIDENCE]` |

## Scenari

### Scenario A — palestra distributore/cliente commerciale senza accesso dati

È il modello prodotto corrente. Non presumere automaticamente un rapporto Art. 28: verificare chi determina finalità e mezzi del trattamento LogBook. Il contratto deve chiarire che l'acquisto/distribuzione non attribuisce alla palestra accesso ai dati dell'utente.

### Scenario B — palestra impartisce istruzioni e LogBook tratta dati per suo conto

Se viene introdotto, valutare un rapporto titolare → responsabile e un accordo Art. 28 con istruzioni documentate, subprocessori, assistenza diritti/DPIA/breach, sicurezza e cancellazione/restituzione.

### Scenario C — finalità/mezzi essenziali determinati congiuntamente

Se i fatti portano a una determinazione congiunta, valutare Art. 26 e trasparenza verso gli interessati.

## Decisione da firmare

- Scenario scelto: `[A/B/C/OTHER]`
- Motivazione fattuale: `[TEXT]`
- Impatto su Privacy Policy: `[TEXT]`
- DPA Art. 28 necessario: `[YES/NO/TO_VALIDATE]`
- Accordo Art. 26 necessario: `[YES/NO/TO_VALIDATE]`
- Data revisione: `[DATE]`
- Validazione professionale: `[NAME/ROLE]`

Rivalutare questo documento prima di introdurre tenant gym, coach, dashboard, inviti gestiti dalla palestra, analytics per palestra o condivisione di dati fitness.
