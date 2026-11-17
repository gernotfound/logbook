# Registro delle attività di trattamento — template TheLogBook

> Template di lavoro Art. 30 GDPR. Compilare in base al ruolo effettivo e far validare prima dell'accesso di utenti esterni.

**Allineamento tecnico:** [AGENTS](../../AGENTS.md), [Telemetria](../../.agents/rules/telemetry-and-privacy.md), [Cifratura](../../.agents/rules/secure-storage.md) e [Consenso](../../.agents/rules/health-consent.md). L'aggiornamento della descrizione tecnica non approva basi giuridiche, retention o ruoli.

## Intestazione

- Titolare dichiarato: Gerardo Califano
- Forma di gestione corrente: persona fisica, progetto amatoriale (non una società)
- Eventuale recapito postale: `[DA VALUTARE/DEFINIRE PRIMA DEL PRIMO UTENTE ESTERNO]`
- Contatto privacy: `thelogbook.privacy@gmail.com` (funzionamento confermato dal product owner il 5 novembre 2026; monitoraggio periodico da organizzare)
- DPO, se applicabile: `[DPO_OR_NOT_APPLICABLE]`
- Versione registro: `[VERSION]`
- Data approvazione: `[DATE]`
- Responsabile dell'approvazione: `[ROLE]`

## Attività 1 — Erogazione TheLogBook e dati applicativi

| Campo | Contenuto da validare |
|---|---|
| Ruolo GDPR | `[DA VALIDARE — vedi controller-role-decision.md]` |
| Interessati | Utenti maggiorenni di TheLogBook |
| Finalità | Erogare funzioni richieste: allenamento, nutrizione, misurazioni, persistenza locale/cloud, sync, recovery |
| Categorie dati | Account; routine/sessioni/esercizi; nutrizione; peso/composizione/circonferenze; sonno; dolori/fatica; preferenze e metadati tecnici |
| Dati particolari | Dati relativi alla salute quando le informazioni inserite rientrano nell'art. 9 GDPR |
| Base Art. 6 | `[TO_VALIDATE]` |
| Condizione Art. 9 | Consenso esplicito attuale; adeguatezza e revoca da validare |
| Fonte | Direttamente dall'utente |
| Destinatari | Fornitori tecnici strettamente necessari; accesso ai dati di altri account negato dall'architettura owner-scoped |
| Trasferimenti extra SEE | Vedi `vendor-transfer-register.md`; `[TO_VERIFY]` |
| Retention | Vedi `retention-schedule.md` |
| Misure | Vedi `technical-organizational-measures.md` |
| Sistemi | Browser/PWA; IndexedDB/localStorage; Firebase Hosting/Authentication/Firestore/App Check; Vercel Functions per backend trusted |

## Attività 2 — Autenticazione e gestione account

| Campo | Contenuto da validare |
|---|---|
| Finalità | Login, identificazione account, recupero accesso, sicurezza sessione |
| Dati | UID Firebase, email e dati restituiti dal provider di autenticazione applicabile |
| Base | `[TO_VALIDATE]` |
| Fornitori | Google/Firebase |
| Retention | Finché l'account è attivo; cancellazione tramite workflow account deletion, salvo record tecnici di recovery limitati |
| Misure | Auth Firebase, Security Rules, App Check lato client; enforcement live da verificare |

## Attività 3 — Gestione locale degli errori (nessun monitoraggio esterno)

| Campo | Contenuto da validare |
|---|---|
| Finalità | Stabilità, diagnosi sul dispositivo e recupero da errori di avvio e persistenza |
| Dati | Marker locali di integrità owner-scoped, senza code di errori o identificativi di sessione per invio diagnostico |
| Destinatari | Nessun fornitore esterno di Error Monitoring per il client; i log Firebase/Vercel costituiscono trattamenti di servizio separati |
| Base | Nessuna base dichiarata per telemetria esterna ormai ritirata; per i log provider verificare le rispettive finalità e basi |
| Retention | Marker locali legati al lifecycle; retention dei log dei servizi esterni da verificare nei provider |
| Misure | Nessun trasporto o SDK diagnostico, isolamento owner, schermate d'errore e protezioni sui dati conservate |

## Attività 4 — Account deletion e recovery

| Campo | Contenuto da validare |
|---|---|
| Finalità | Cancellazione sicura, idempotenza e recovery cross-device |
| Dati | Job tecnico, timestamp/stato, hash non reversibile della receipt; nessun dato fitness nel tombstone finale |
| Retention | 30 giorni per il tombstone tecnico, poi purge giornaliero previsto |
| Sistema | Vercel Functions + Firebase Admin + Firestore/Auth |
| Accesso | Server-only |

## Attività 5 — Richieste privacy e supporto

| Campo | Contenuto da validare |
|---|---|
| Finalità | Gestire diritti, richieste, reclami, supporto e incidenti |
| Dati | Identità/contatto del richiedente, contenuto della richiesta, evidenze minime, esito |
| Base | Obbligo legale / gestione rapporto secondo il caso |
| Retention | `[DEFINE_CASE_FILE_RETENTION]` |
| Canale | `thelogbook.privacy@gmail.com` (funzionamento dichiarato verificato dal product owner) / `[SUPPORT_EMAIL]` se verrà attivato un supporto separato |

## Registro modifiche

| Data | Versione | Modifica | Approvata da |
|---|---|---|---|
| `[DATE]` | `[VERSION]` | Prima emissione | `[ROLE]` |
