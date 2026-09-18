# Piano — correzioni audit runtime React/Analytics

Data: 18 settembre 2026. Baseline: `4def1190f04a513f656cb1d4c1a1fc97f7b4527c` (`main`).
Stato: autorizzato dal product owner con richiesta di proseguire autonomamente sulle correzioni residue dell'audit.

## Scope

- DEF-12: rendere esplicita e osservabile la dipendenza temporale della Home, evitando valori derivati da `Date.now()` congelati dentro `useMemo`.
- DEF-13: correggere il vero race di readiness Firebase Analytics: il consenso può diventare attivo prima che l'istanza Analytics asincrona sia pronta, facendo perdere il primo evento SPA.
- DEF-14: eliminare la closure potenzialmente stale del listener globale `app:navigate` e rimuovere lo pseudo-ref inutilizzato in `App.tsx`.
- DEF-17: generare le date giornaliere dei fixture analytics con la semantica locale canonica invece di `toISOString().slice(0, 10)`.

## Decisioni tecniche

- La Home userà un clock a bassa frequenza, aggiornato anche al ritorno in foreground, per invalidare solo i calcoli realmente dipendenti dal tempo senza introdurre polling aggressivo.
- Firebase esporrà un getter asincrono consent-aware per ottenere Analytics solo quando supportato, inizializzato e ancora autorizzato; i consumer non leggeranno più una variabile mutabile come segnale di readiness.
- Il listener `app:navigate` userà il meccanismo React 19 `useEffectEvent`, così il listener resta stabile ma vede sempre lo stato corrente.
- Le date evento/audit UTC restano UTC; cambia soltanto la costruzione di fixture che rappresentano giorni locali.

## Invarianti

- Nessuna modifica a dati utente, schema persistito, IndexedDB, protocollo sync o Firestore Rules.
- Analytics resta disabilitato senza consenso e viene disattivato immediatamente alla revoca.
- Nessun evento Analytics viene inviato dopo una revoca avvenuta durante una inizializzazione asincrona.
- I branch di sviluppo non generano Preview Deployment Vercel.

## Verifica

- test unitario del clock Home con fake timers/foreground refresh;
- test isolato Analytics per readiness asincrona e revoca concorrente;
- test del listener `app:navigate` dopo cambi di stato senza reinstallazione necessaria;
- fixture analytics prive di conversione UTC per date giornaliere;
- gate canonico `npm run verify:m8` sull'esatto HEAD;
- review finale, merge, CI post-merge e Vercel production sul merge SHA.

## Rollback

Il lotto non modifica formati persistiti o contratti cloud. È revertibile come unità senza migrazioni o cleanup dati.
