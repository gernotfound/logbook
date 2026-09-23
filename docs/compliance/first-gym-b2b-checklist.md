# Checklist di consegna — prima palestra

> Nessuna consegna reale finché i gate applicabili non sono chiusi e le evidenze sono archiviate.

## Gate tecnico

- `[ ]` Production deriva da `main`.
- `[ ]` Canonical Verification è verde sullo SHA effettivo di Production.
- `[ ]` Vercel Production è READY sullo stesso stato.
- `[ ]` Smoke home/API pertinenti sono verdi.
- `[ ]` Security Rules Firestore live corrispondono alla sorgente approvata.
- `[ ]` App Check enforcement live è verificato sui servizi applicabili.
- `[ ]` Firebase Auth authorized domains e restrizioni API key sono verificati.
- `[ ]` Test account A → logout → account B dimostra assenza di leakage locale.
- `[ ]` Account deletion E2E reale arriva a completion anche attraverso il recovery path.
- `[ ]` Il cron di recovery/cancellazione è stato osservato in un'esecuzione reale recente.
- `[ ]` Backup/PITR ha una decisione documentata; se abilitato, il restore è stato provato.
- `[ ]` Retention della telemetria è automatizzata e verificata live.
- `[ ]` Test installazione/uso su iPhone PWA, Android PWA e browser pertinenti sono completati.
- `[ ]` Audit accessibilità automatico e manuale pertinente è completato.
- `[ ]` Accessi amministrativi e MFA sono verificati per i sistemi critici.

## Gate privacy e accountability

- `[ ]` Identità del provider e contatto privacy sono inseriti nei documenti destinati agli utenti.
- `[ ]` Ruoli provider/palestra sono decisi sui fatti e validati professionalmente.
- `[ ]` Registro delle attività di trattamento è compilato e approvato.
- `[ ]` DPIA screening è firmato; DPIA completa eseguita se il risultato lo richiede.
- `[ ]` Valutazione sull'eventuale DPO è documentata.
- `[ ]` Retention schedule è approvata e corrisponde al runtime reale.
- `[ ]` Vendor/subprocessor/transfer register è completato.
- `[ ]` LIA della telemetria tecnica è documentata se si mantiene il legittimo interesse come base.
- `[ ]` Incident/data-breach runbook è assegnato e provato.
- `[ ]` Procedura per i diritti degli interessati è operativa.
- `[ ]` Revoca del consenso dati salute è implementata e testata.
- `[ ]` Analytics opzionali restano disabilitati per default e revocabili.
- `[ ]` Privacy Policy e Termini corrispondono al modello commerciale e ai fornitori effettivi.

## Gate contrattuale e commerciale

- `[ ]` `[PROVIDER_LEGAL_NAME]`, forma giuridica, sede e dati fiscali sono definiti.
- `[ ]` Accordo SaaS con la palestra è revisionato professionalmente.
- `[ ]` DPA Art. 28 è allegato soltanto se il ruolo fattuale lo richiede.
- `[ ]` Eventuale accordo Art. 26 è predisposto se emerge contitolarità.
- `[ ]` Elenco subprocessori è allegato quando pertinente.
- `[ ]` Canone, durata, rinnovo/recesso e support commitment sono definiti.
- `[ ]` Informativa e Termini sono revisionati professionalmente.
- `[ ]` Adempimenti fiscali/fatturazione sono verificati con un consulente competente.
- `[ ]` Contratto è firmato prima della distribuzione commerciale.

## Gate modello prodotto

Per il primo pilot, salvo successiva decisione esplicita:

- la palestra non accede ai dati LogBook degli utenti;
- non esiste tenant gym/coach/admin;
- servizio destinato a maggiorenni;
- pagamenti e fatturazione restano fuori dalla PWA;
- nessun uso dei dati fitness per advertising o profilazione commerciale;
- nessuna condivisione automatica di dati con la palestra.

Qualunque variazione riapre almeno role decision, DPIA, Privacy Policy, Terms e contratto.

## Evidenza di go-live

- Data: `[DATE]`
- SHA Production: `[SHA]`
- Deployment Vercel: `[DEPLOYMENT_ID]`
- CI run: `[RUN_ID]`
- Versione documentazione legale: `[VERSION]`
- Revisore privacy/legale: `[NAME/ROLE]`
- Firmatario provider: `[NAME/ROLE]`
- Firmatario palestra: `[NAME/ROLE]`
- Decisione: `[GO / NO-GO]`
