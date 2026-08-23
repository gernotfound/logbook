# Original User Request

## 2026-08-22T20:44:14Z

# Teamwork Project Prompt — Draft

> Status: Ready for launch — awaiting user approval
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Team completo

Risolvere il bug di Firebase "Missing or insufficient permissions" e gli avvisi relativi ad AppCheck che si verificano durante l'eliminazione di una sessione di allenamento.

Working directory: C:\Users\gerar\Documents\GitHub\logbook
Integrity mode: development

## Requirements

### R1. Risoluzione dei permessi di eliminazione
Identificare e correggere la causa principale dell'errore "Missing or insufficient permissions" che blocca l'eliminazione degli allenamenti su Firestore. L'operazione deve potersi concludere con successo per i documenti posseduti dall'utente.

### R2. Gestione AppCheck
Sistemare la logica legata all'avviso "App Check fallito o non supportato", facendo in modo che l'assenza della chiave VITE_RECAPTCHA_V3_SITE_KEY gestisca il fallback correttamente senza sollevare eccezioni bloccanti sui successivi accessi al database.

## Acceptance Criteria

### Verifica
- [ ] È stato creato uno script o un test automatico che simuli o verifichi l'eliminazione di un allenamento, accertando l'assenza di errori di permesso (ad es. testando l'operazione in un ambiente di test o tramite le Firebase Security Rules test utilities).
- [ ] Eliminando un allenamento, l'operazione ha successo e il messaggio "Errore critico durante il salvataggio Firestore" non viene più lanciato nell'app.
- [ ] L'applicazione gestisce l'inizializzazione di AppCheck in modo non distruttivo (se la chiave è assente, disabilita il check in modo pulito invece di degradare le funzioni di Firebase).
