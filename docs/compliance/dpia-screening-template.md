# Screening DPIA — LogBook

> Screening preliminare Art. 35 GDPR. Non sostituisce una DPIA completa quando il trattamento è suscettibile di presentare un rischio elevato.

## Ambito

- Trattamento: PWA LogBook per allenamento, nutrizione, misurazioni corporee, sync cloud e recovery.
- Popolazione: utenti maggiorenni; dimensione pilot `[NUMBER]`.
- Organizzazioni coinvolte: `[PROVIDER]`, `[GYM]`, fornitori tecnici.
- Versione architettura/repository: `[MAIN_SHA]`.
- Data screening: `[DATE]`.

## Fattori da valutare

| Fattore | Valutazione preliminare | Evidenza/nota |
|---|---|---|
| Categorie particolari / dati altamente personali | **Sì** | Peso, composizione, dolore/fatica, sonno e altre informazioni possono costituire dati salute |
| Valutazione/scoring di persone | `[YES/NO/PARTIAL]` | Distinguere calcoli per uso personale da decisioni del provider/palestra |
| Decisioni automatizzate con effetto giuridico o analogo significativo | Attualmente `[NO — VERIFY]` | Nessuna decisione di accesso/servizio basata su scoring prevista |
| Monitoraggio sistematico | `[TO_VALIDATE]` | L'utente auto-traccia; valutare se finalità/strumenti del provider costituiscono monitoraggio sistematico |
| Larga scala | `[NO/YES/UNKNOWN]` | Documentare utenti, durata, geografia, volume e categorie dati |
| Matching/combinazione dataset | Attualmente `[NO — VERIFY]` | Nessun data brokerage o arricchimento esterno previsto |
| Soggetti vulnerabili | Pilot 18+; `[TO_VALIDATE]` | Rivalutare se cambiano target o contesto |
| Uso innovativo/nuove tecnologie | `[TO_VALIDATE]` | PWA/cloud standard; considerare natura e modalità concrete |
| Impossibilità pratica di esercitare un diritto/servizio | `[TO_VALIDATE]` | In particolare consenso salute e revoca |
| Trasferimenti/infrastruttura internazionale | `[TO_VALIDATE]` | Vedi vendor/transfer register |

## Rischi principali da analizzare

1. Accesso non autorizzato ai dati salute.
2. Leakage fra account sullo stesso dispositivo.
3. Corruzione/perdita dei dati offline o durante sync.
4. Cancellazione incompleta tra dispositivo, Firestore e Auth.
5. Telemetria che incorpori accidentalmente contenuto personale.
6. Configurazioni esterne non allineate al codice (Rules/App Check/segreti).
7. Revoca del consenso salute senza reale cessazione del trattamento.
8. Trasferimenti o subprocessori non documentati.
9. Uso futuro da parte della palestra senza nuova analisi dei ruoli.

## Misure già presenti da verificare

- owner scoping Firestore e test Security Rules;
- persistenza locale owner-scoped e recovery fail-closed;
- cache Firestore runtime solo in memoria;
- sanitizzazione/allowlist della telemetria;
- account deletion server-mediated e tombstone recovery;
- CI exact-SHA e branch protection workflow;
- optional analytics opt-in;
- CSP e security headers;
- segreti server fuori dal bundle client.

## Blocker noti per lo screening

- `[ ]` flusso completo di revoca consenso salute deciso e implementato;
- `[ ]` retention telemetria tecnicamente enforced;
- `[ ]` stato live di App Check/Rules/API restrictions verificato;
- `[ ]` restore/backup policy decisa;
- `[ ]` ruoli provider/palestra firmati;
- `[ ]` vendor/transfer register completato.

## Decisione

- DPIA completa richiesta: `[YES/NO]`
- Motivazione: `[TEXT]`
- Se no, data di riesame: `[DATE/TRIGGER]`
- Trigger obbligatori di riesame: aumento significativo scala, minori, coach/gym access, nuove fonti dati, nuove finalità, AI/profilazione, nuovi trasferimenti, incidente grave.
- Approvazione: `[ROLE/DATE]`
- Revisione professionale: `[ROLE/DATE]`
