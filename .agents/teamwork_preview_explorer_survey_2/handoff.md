# Handoff Report — AppCheck Initialization & Fallback Survey

## 1. Observation

1. **In `src/lib/firebase.ts` (righe 54-60):**
   ```typescript
   // App Check (ReCaptchaV3Provider)
   import { initAppCheck, isAppCheckFallbackOffline } from './appCheck';
   initAppCheck(app).then((res) => {
       if (!res.success) {
           console.warn("App Check fallito o non supportato. App in modalit degradata.", res.reason);
       }
   });
   ```
2. **In `src/lib/appCheck.ts` (righe 87-107):**
   ```typescript
   const siteKey = options?.siteKey || 
       import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY || 
       import.meta.env.VITE_RECAPTCHA_SITE_KEY;
   ...
   if (!siteKey || siteKey.trim() === '') {
       console.warn(`[AppCheck] ${APP_CHECK_STRINGS.missingSiteKeyWarning}`);
       isFallbackOfflineMode = true;
       return {
           success: false,
           appCheck: null,
           isFallbackOffline: true,
           reason: APP_CHECK_STRINGS.missingSiteKeyWarning
       };
   }
   ```
3. **Verbatim Error / Log Output durante i test (`npm.cmd test` / task-57):**
   ```
   stderr | tests/...
   [AppCheck] Chiave reCAPTCHA v3 (VITE_RECAPTCHA_V3_SITE_KEY) non configurata. App Check non inizializzato.
   stderr | tests/...
   App Check fallito o non supportato. App in modalit degradata. Chiave reCAPTCHA v3 (VITE_RECAPTCHA_V3_SITE_KEY) non configurata. App Check non inizializzato.
   ```
4. **In `src/lib/appCheck.ts` (righe 61-77):**
   `isAppCheckSupported()` verifica solo `typeof window === 'undefined'` e non invoca `isSupported()` dall'SDK `firebase/app-check`.
5. **In `tests/setup.tsx` (riga 153):**
   Il mock di `firebase/auth` contiene `browserLocalPersistence: {}` ma manca `indexedDBLocalPersistence: {}`, provocando l'errore: `Error: [vitest] No "indexedDBLocalPersistence" export is defined on the "firebase/auth" mock.`

## 2. Logic Chain

1. **Da Obs. 1 e Obs. 2:** Quando `VITE_RECAPTCHA_V3_SITE_KEY` non è configurata (comportamento standard quando non si usa reCAPTCHA v3 o in ambienti di test/dev locale), `initAppCheck` tratta l'assenza come un errore (`success: false`), logga un primo warning e imposta `isFallbackOfflineMode = true`.
2. **Da Obs. 1 e Obs. 3:** La promise in `src/lib/firebase.ts` riceve `res.success === false` e stampa un secondo warning con il testo allarmante `"App Check fallito o non supportato. App in modalit degradata."`. Questo messaggio è ingannevole perché l'assenza di AppCheck in un progetto Firebase senza enforcement non impedisce né degrada le comunicazioni di Firestore o Auth.
3. **Da Obs. 4:** L'omissione di `isSupported()` da `firebase/app-check` impedisce di rilevare browser o ambienti headless che non supportano IndexedDB o Web Crypto prima di tentare l'inizializzazione.
4. **Da Obs. 5:** La combinazione dell'esecuzione di `initAppCheck` all'import di `src/lib/firebase.ts` con la mancanza di `indexedDBLocalPersistence` nel mock di test provoca fallimenti immediati e centinaia di righe di log di warning in `stderr` su tutte le 70 suite di test.

## 3. Caveats

- **Enforcement su Firebase Console:** Se un amministratore attiva l'enforcement rigido di AppCheck nella console Firebase, le chiamate Firestore senza un token AppCheck valido verranno bloccate con `permission-denied` dal server. In tal caso l'app gestirà l'errore tramite `errorHandler.ts`. Questa indagine assume che l'enforcement non sia forzato lato server qualora la chiave non sia configurata nel client.
- Nessun'altra limitazione riscontrata.

## 4. Conclusion

1. **Comportamento quando la chiave è assente:** L'assenza di `VITE_RECAPTCHA_V3_SITE_KEY` deve essere trattata come una disabilitazione intenzionale e pulita (`disabled: true`, `success: true`, `isFallbackOffline: false`), senza emettere `console.warn` né segnalare "modalità degradata".
2. **Supporto Browser:** Integrare la chiamata reale a `isSupported()` dell'SDK Firebase per una disabilitazione sicura in ambienti non supportati.
3. **Resilienza:** Se AppCheck è configurato ma l'acquisizione del token fallisce, la gestione interna con retry in background è già corretta e non genera crash runtime.

## 5. Verification Method

1. **Ispezione file:**
   - Verificare `src/lib/appCheck.ts` e `src/lib/firebase.ts` per accertare che l'assenza di chiave non sollevi warning.
   - Verificare `tests/setup.tsx` per la presenza di `indexedDBLocalPersistence` nel mock `firebase/auth`.
2. **Comando di test:**
   - Eseguire `npm.cmd test` nel terminale per verificare che la suite di test si completi senza warning di AppCheck in `stderr`.
3. **Condizione di invalidazione:**
   - Se all'avvio dell'app in assenza di `VITE_RECAPTCHA_V3_SITE_KEY` compare il warning `"App in modalit degradata"` o `"Chiave reCAPTCHA v3 non configurata"`, la modifica è incompleta.
