# Checklist di consegna — prima palestra

> Nessuna consegna reale finché i gate applicabili non sono chiusi e le evidenze sono archiviate.

I collaudi sono requisiti di evidenza, non autorizzazioni a creare un ambiente Test o ad avviare operazioni distruttive in Production. Il cloud Test separato è dismesso: gli scenari distruttivi restano pendenti finché non viene definito un perimetro di prova esplicitamente autorizzato e isolato, secondo [E2E e Production](../operations/e2e-reliability.md) e [AGENTS](../../AGENTS.md).

## Gate tecnico

- `[ ]` Production deriva da `main`.
- `[ ]` Canonical Verification è verde sullo SHA effettivo di Production.
- `[ ]` Firebase Hosting Production è sulla release derivata dallo stesso `main` verificato.
- `[ ]` Vercel backend Production deriva da main: deployment pertinente READY oppure skip verificato per assenza di delta backend. Registrare lo SHA effettivamente distribuito separatamente da Hosting; non richiedere un redeploy di un diff irrilevante.
- `[ ]` Smoke home/API pertinenti sono verdi.
- `[ ]` Security Rules Firestore live corrispondono alla sorgente approvata.
- `[ ]` App Check enforcement live è verificato sui servizi applicabili.
- `[ ]` Firebase Auth authorized domains e restrizioni API key sono verificati.
- `[ ]` Test account A → logout → account B dimostra assenza di leakage locale.
- `[ ]` Account deletion E2E reale arriva a completion anche attraverso il recovery path.
- `[ ]` Il cron di recovery/cancellazione è stato osservato in un'esecuzione reale recente.
- `[ ]` Backup/PITR ha una decisione documentata; se abilitato, il restore è stato provato.
- `[ ]` La retention dei log Firebase/Vercel e dell'archivio Sentry storico è verificata nei provider; la decisione attuale non prevede la cancellazione degli eventi Sentry.
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
- `[ ]` Le basi e le eventuali LIA dei trattamenti esterni ancora attivi sono valutate; la telemetria automatica client è ritirata.
- `[ ]` Incident/data-breach runbook è assegnato e provato.
- `[ ]` Procedura per i diritti degli interessati è operativa.
- `[ ]` Revoca del consenso dati salute è implementata e testata.
- `[ ]` Nessuna integrazione Analytics o Error Monitoring reintrodotta nel client.
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

- la palestra non accede ai dati TheLogBook degli utenti;
- non esiste tenant gym/coach/admin;
- servizio destinato a maggiorenni;
- pagamenti e fatturazione restano fuori dalla PWA;
- nessun uso dei dati fitness per advertising o profilazione commerciale;
- nessuna condivisione automatica di dati con la palestra.

Qualunque variazione riapre almeno role decision, DPIA, Privacy Policy, Terms e contratto.

## Evidenza di go-live

- Data: `[DATE]`
- SHA Production: `[SHA]`
- Release Firebase Hosting: `[RELEASE_ID/RUN_ID]`
- Deployment Vercel backend: `[DEPLOYMENT_ID]`
- CI run: `[RUN_ID]`
- Versione documentazione legale: `[VERSION]`
- Revisore privacy/legale: `[NAME/ROLE]`
- Firmatario provider: `[NAME/ROLE]`
- Firmatario palestra: `[NAME/ROLE]`
- Decisione: `[GO / NO-GO]`
