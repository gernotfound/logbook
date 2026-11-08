## Obiettivo e perimetro
Descrivere problema, comportamento atteso e root cause se pertinente.

- Mandato effettivamente autorizzato: indicare la fase massima (solo branch, PR draft, merge, rilascio). Una PR non autorizza implicitamente merge o deploy; se il merge non è autorizzato, mantenere la PR draft e auto-merge disabilitato.
- Fonte operativa: [AGENTS.md](../AGENTS.md) e unione dei contratti pertinenti.

## Rischio e invarianti
- Classe: STANDARD / SENSITIVE / CRITICAL (motivare).
- Invarianti preservati (dati, sync, Auth, sicurezza, accessibilità, UX, ecc.).
- Dipendenze / PR concorrenti o modifiche a versioni persistite e contratti.

## Revisione ingegneristica e refactoring
- Per ogni file target di audit: responsabilità, modularità, accoppiamento, duplicazioni, complessità, tipi, errori, codice inutilizzato e qualità dei test; verificare i chiamanti e i contratti collegati.
- Distinguere difetti dimostrati, opportunità di refactoring e scelte intenzionali da mantenere. Documentare beneficio, rischio ed esito delle modifiche proposte; non introdurre refactoring cosmetici.

## Modifiche e regressioni
- File e componenti coinvolti; test aggiunti o modificati.
- Eventuali migrazioni, rollback o recovery (se applicabili).

## Evidenze verificabili
- `main` base SHA e SHA **candidato**: compilare con dati reali, non anticipare la CI.
- Test locali realmente eseguiti e relativo esito; subset diagnostici distinti.
- Distinguere `npm run verify:m8` locale dalla CI PR `Milestone Verification` (`Canonical Verification`, inclusa `Security / CodeQL`): indicare esiti realmente osservati sullo SHA esatto e link alla run; altrimenti segnare *non eseguito / in corso / mancante*.
- Review: verificare le approvazioni effettivamente richieste dal ruleset e la risoluzione dei thread bloccanti; nuovi commit invalidano i risultati precedenti.

## Dopo il merge (solo se autorizzato; non anticipare)
- SHA remoto di `main`, `Main Release Gate` e CodeQL post-merge: riportare soltanto esiti realmente osservati sullo SHA di `main`, separati dalla CI della PR.
- Firebase Hosting, Firestore Rules/indici, Vercel Production e smoke runtime: segnare *verificato / non applicabile / mancante* con prova, secondo il diff.
- Limiti, verifiche manuali pendenti e rischi residui.

> Nota: una PR draft non è una dichiarazione di test, deploy o runtime riusciti. Non indebolire i gate per facilitare la conclusione. Prima della CI del candidato per l'integrazione applicare il bump PWA obbligatorio `MAJOR.MINOR.PATCH` → `MAJOR.(MINOR+1).0`, con entrambi i campi root di `package-lock.json` coerenti e il numero calcolato dal `main` remoto corrente; un nuovo merge concorrente impone ricalcolo e nuova verifica.
