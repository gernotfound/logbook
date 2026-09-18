# Piano — correzioni audit runtime React/Analytics

Data: 18 settembre 2026. Baseline: `4def1190f04a513f656cb1d4c1a1fc97f7b4527c` (`main`).
Stato: autorizzato dal product owner con richiesta di proseguire autonomamente sulle correzioni residue dell'audit.

## Scope

- DEF-12: rendere esplicita e osservabile la dipendenza temporale della Home, evitando valori derivati da `Date.now()` congelati dentro `useMemo`.
- DEF-13: correggere il vero race di readiness Firebase Analytics: il consenso può diventare attivo prima che l'istanza Analytics asincrona sia pronta, facendo perdere il primo evento SPA.
- DEF-14: stabilizzare il listener globale `app:navigate`, rimuovere lo pseudo-ref inutilizzato e garantire che il listener legga sempre lo stato React corrente.
- DEF-17: verificato come falso positivo nel codice corrente. I `toISOString().slice(0, 10)` segnalati sono esclusivamente generatori di fixture deterministicamente ancorati a mezzogiorno UTC (`...T12:00:00Z`) nei test analytics, non conversioni di date giornaliere utente. Sostituirli con il fuso locale renderebbe i fixture dipendenti dal timezone del runner e quindi meno deterministici.

## Decisioni tecniche

- La Home userà un clock a bassa frequenza, aggiornato anche al ritorno in foreground, per invalidare solo i calcoli realmente dipendenti dal tempo senza introdurre polling aggressivo.
- Firebase esporrà un getter asincrono consent-aware per ottenere Analytics solo quando supportato, inizializzato e ancora autorizzato; i consumer non leggeranno più una variabile mutabile come segnale di readiness.
- Il listener `app:navigate` userà il meccanismo React 19 `useEffectEvent`, così il listener resta stabile ma vede sempre lo stato corrente.
- Le date giornaliere di produzione continuano a usare la semantica locale canonica; i fixture UTC esplicitamente ancorati restano UTC perché rappresentano un asse temporale sintetico del test, non una data utente.

## Invarianti

- Nessuna modifica a dati utente, schema persistito, IndexedDB, protocollo sync o Firestore Rules.
- Analytics resta disabilitato senza consenso e viene disattivato immediatamente alla revoca.
- Nessun evento Analytics viene inviato dopo una revoca avvenuta durante una inizializzazione asincrona.
- I branch di sviluppo non generano Preview Deployment Vercel.

## Verifica

- test unitario del clock Home con fake timers/foreground refresh;
- test isolato Analytics per readiness asincrona e revoca concorrente;
- test del listener `app:navigate` dopo cambi di stato senza reinstallazione necessaria;
- verifica manuale del contesto dei fixture DEF-17 per distinguere date sintetiche UTC da date giornaliere utente;
- gate canonico `npm run verify:m8` sull'esatto HEAD;
- review finale, merge, CI post-merge e Vercel production sul merge SHA.

## Rollback

Il lotto non modifica formati persistiti o contratti cloud. È revertibile come unità senza migrazioni o cleanup dati.
