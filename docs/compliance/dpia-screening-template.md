# Screening DPIA — TheLogBook

> Screening preliminare Art. 35 GDPR. Non sostituisce una DPIA completa quando il trattamento è suscettibile di presentare un rischio elevato.

## Ambito

- Trattamento: PWA TheLogBook per allenamento, nutrizione, misurazioni corporee, sync cloud e recovery.
- Popolazione: utenti maggiorenni; numero effettivo o previsto `[NUMBER]`.
- Soggetti coinvolti: gestore TheLogBook e fornitori tecnici effettivamente utilizzati, da validare.
- Versione architettura/repository: `[MAIN_SHA]`.
- Data screening: `[DATE]`.

## Fattori da valutare

| Fattore | Valutazione preliminare | Evidenza/nota |
|---|---|---|
| Categorie particolari / dati altamente personali | **Sì** | Peso, composizione, dolore/fatica, sonno e altre informazioni possono costituire dati salute |
| Valutazione/scoring di persone | `[YES/NO/PARTIAL]` | Distinguere calcoli per uso personale da decisioni del gestore |
| Decisioni automatizzate con effetto giuridico o analogo significativo | Attualmente `[NO — VERIFY]` | Nessuna decisione di accesso/servizio basata su scoring prevista |
| Monitoraggio sistematico | `[TO_VALIDATE]` | L'utente auto-traccia; valutare se finalità/strumenti del provider costituiscono monitoraggio sistematico |
| Larga scala | `[NO/YES/UNKNOWN]` | Documentare utenti, durata, geografia, volume e categorie dati |
| Matching/combinazione dataset | Attualmente `[NO — VERIFY]` | Nessun data brokerage o arricchimento esterno previsto |
| Soggetti vulnerabili | Utenti 18+; `[TO_VALIDATE]` | Rivalutare se cambiano target o contesto |
| Uso innovativo/nuove tecnologie | `[TO_VALIDATE]` | PWA/cloud standard; considerare natura e modalità concrete |
| Impossibilità pratica di esercitare un diritto/servizio | `[TO_VALIDATE]` | In particolare consenso salute e revoca |
| Trasferimenti/infrastruttura internazionale | `[TO_VALIDATE]` | Vedi vendor/transfer register |

## Rischi principali da analizzare

1. Accesso non autorizzato ai dati salute.
2. Leakage fra account sullo stesso dispositivo.
3. Corruzione/perdita dei dati offline o durante sync.
4. Cancellazione incompleta tra dispositivo, Firestore e Auth.
5. Log tecnici dei fornitori Firebase/Vercel che incorporino accidentalmente contenuti personali.
6. Configurazioni esterne non allineate al codice (Rules/App Check/segreti).
7. Revoca del consenso salute senza reale cessazione del trattamento.
8. Trasferimenti o subprocessori non documentati.
9. Perdita o sostituzione della KEK cloud: ciphertext account irrecuperabile senza custodia e ripristino indipendenti; cifratura trusted diversa da E2EE.

## Misure già presenti da verificare

- owner scoping Firestore e test Security Rules;
- persistenza locale owner-scoped cifrata con vault e recovery fail-closed; i marker locali di integrità non costituiscono una coda diagnostica né inviano report esterni;
- chiave cloud per-account indipendente dal vault device, custodia server-only e verifica esterna del backup/ripristino KEK secondo [Cifratura](../../.agents/rules/secure-storage.md); questo documento non attesta tali prove;
- cache Firestore runtime solo in memoria;
- nessun monitoraggio automatico degli errori client; isolamento owner dei marker e controlli di recovery preservati;
- account deletion server-mediated e tombstone recovery;
- CI exact-SHA e branch protection workflow;
- nessuna integrazione di analytics o Error Monitoring nel frontend;
- CSP e security headers;
- segreti server fuori dal bundle client.

## Blocker noti per lo screening

- `[ ]` revoca consenso salute: implementazione e regressioni integrate; completare collaudo autenticato multi-dispositivo e validazione legale prima dell'apertura a utenti esterni;
- `[ ]` verificare retention e trattamento dei log tecnici dei servizi Firebase/Vercel;
- `[ ]` stato live di App Check/Rules/API restrictions verificato;
- `[ ]` restore/backup policy decisa;
- `[ ]` ruolo del gestore e garanzie dei fornitori tecnici documentati e validati;
- `[ ]` vendor/transfer register completato.

## Decisione

- DPIA completa richiesta: `[YES/NO]`
- Motivazione: `[TEXT]`
- Se no, data di riesame: `[DATE/TRIGGER]`
- Trigger obbligatori di riesame: aumento significativo scala, minori, nuovo accesso di soggetti terzi ai dati, nuove fonti dati, nuove finalità, AI/profilazione, nuovi trasferimenti, incidente grave.
- Approvazione: `[ROLE/DATE]`
- Revisione professionale: `[ROLE/DATE]`
