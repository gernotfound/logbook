## Obiettivo e perimetro
Descrivere il comportamento atteso, la root cause se pertinente, e ciò che non cambia.

## Rischio e invarianti
- Classe: STANDARD / SENSITIVE / CRITICAL (motivare).
- Invarianti preservati (dati, sync, Auth, sicurezza, accessibilità, UX, ecc.).
- Dipendenze / PR concorrenti o modifiche a versioni persistite e contratti.

## Modifiche e regressioni
- File e componenti coinvolti; test aggiunti o modificati.
- Eventuali migrazioni, rollback o recovery (se applicabili).

## Evidenze verificabili
- `main` base SHA e SHA **candidato**: compilare con dati reali, non anticipare la CI.
- Test locali realmente eseguiti e relativo esito; subset diagnostici distinti.
- `verify:m8` / `Canonical Verification`: indicare solo risultati osservati sullo SHA esatto, con link alla run.
- Review e thread bloccanti risolti; nuovi commit invalidano i risultati precedenti.

## Dopo il merge (non anticipare)
- SHA remoto di `main` e CI post-merge realmente verificati.
- Firebase Hosting, Firestore Rules/indici, Vercel Production e smoke runtime: segnare *verificato / non applicabile / mancante* con prova, secondo il diff.
- Limiti, verifiche manuali pendenti e rischi residui.

> Nota: una PR draft non è una dichiarazione di test, deploy o runtime riusciti. Non indebolire i gate per facilitare la conclusione. Il bump minor della PWA, se previsto dalle regole correnti, va incluso prima della CI exact-SHA.
