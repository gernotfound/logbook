# Analisi Tecnica: Inizializzazione e Fallback di Firebase AppCheck (LogBook)

## 1. Executive Summary

L'analisi dell'inizializzazione di **Firebase App Check** nel codebase di LogBook (`src/lib/appCheck.ts` e `src/lib/firebase.ts`) ha evidenziato le cause all'origine del messaggio di avviso ricorrente:
`"App Check fallito o non supportato. App in modalit degradata."`

### Sintesi delle Scoperte Principali:
1. **Origine del Warning / Rumore nei Log:** 
   - `VITE_RECAPTCHA_V3_SITE_KEY` è una variabile d'ambiente opzionale per la sicurezza Spark/reCAPTCHA v3.
   - Quando la chiave non è configurata (default in ambienti di sviluppo locale, CI/CD o test unitari), `initAppCheck` considera l'assenza della chiave come un fallimento (`success: false`), logga un primo warning (`[AppCheck] Chiave reCAPTCHA v3... non configurata`) e attiva lo stato `isFallbackOfflineMode = true`.
   - Successivamente, in `src/lib/firebase.ts`, la Promise intercetta `!res.success` ed emette un secondo warning con la dicitura allarmante `"App in modalit degradata."` (con tanto di refuso nel carattere accentato).
   - Questo genera un doppio warning ad ogni avvio dell'app e in tutti i 70 file della suite di test `vitest`.
2. **Impatto Reale sulle Operazioni Firebase (Firestore & Auth):**
   - **Nessuna eccezione bloccante non gestita:** La funzione `initAppCheck` gestisce gli errori e restituisce un oggetto `AppCheckResult`, senza lanciare eccezioni non catturate.
   - **Nessun token corrotto allegato:** Poiché `initializeAppCheck(app)` non viene invocato quando la chiave è assente, nessun provider AppCheck viene registrato nel client Firebase. Le richieste Firestore e Auth viaggiano senza header AppCheck.
   - **Nessuna degradazione effettiva su Firestore/Auth standard:** Se il progetto Firebase backend non ha imposto l'enforcement rigido di AppCheck (o se AppCheck è in modalità monitoraggio/disabilitato), tutte le operazioni di lettura, scrittura, batch ed eliminazione su Firestore e di login su Auth funzionano al 100% della loro capacità.
   - **Tuttavia:** L'assegnazione arbitraria di `isFallbackOfflineMode = true` quando la chiave è semplicemente assente è semanticamente scorretta e fuorviante per la telemetria (`getAppCheckStatus()`).
3. **Lacuna nell'ispezione del supporto browser:**
   - In `src/lib/appCheck.ts`, la funzione `isAppCheckSupported()` si limita a verificare `typeof window === 'undefined'`, omettendo l'invocazione di `isSupported()` dall'SDK `firebase/app-check`.

---

## 2. Architettura Attuale e Flusso di Esecuzione

### 2.1 Catena delle Chiamate all'Avvio
```
src/main.tsx
  └── initApp()
        └── <AuthProvider> (src/contexts/AuthContext.tsx)
              └── import { auth, db, ... } from './lib/firebase.ts'
                    ├── initializeApp(firebaseConfig)
                    ├── initAppCheck(app) [src/lib/appCheck.ts] (Esecuzione asincrona immediata)
                    ├── initializeFirestore(app, { localCache: ... })
                    └── getAuth(app)
```

### 2.2 Gestione delle Variabili d'Ambiente (`import.meta.env`)
In `src/lib/firebase.ts`:
- Vengono controllate rigorosamente le 8 variabili d'ambiente essenziali di Firebase (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, etc.) secondo la regola di *fail-fast* immediato definita in `AGENTS.md`. Se una sola manca, l'app lancia un'eccezione bloccante.
- `VITE_RECAPTCHA_V3_SITE_KEY` (e il fallback legacy `VITE_RECAPTCHA_SITE_KEY`) **non** fa parte delle variabili obbligatorie, trattandosi di un layer di protezione opzionale per il tier gratuito reCAPTCHA v3.

In `src/lib/appCheck.ts`:
```typescript
const siteKey = options?.siteKey || 
    import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY || 
    import.meta.env.VITE_RECAPTCHA_SITE_KEY;
```
Se nessuna delle due variabili è presente in `.env` o nei settings di Vercel:
- `siteKey` risulta `undefined` o stringa vuota `""`.

---

## 3. Analisi di Dettaglio: Cause del Warning e Stati di Errore

### 3.1 Scenario A: `VITE_RECAPTCHA_V3_SITE_KEY` Assente o Vuota (Default)
1. In `src/lib/appCheck.ts` (righe 98-107):
   ```typescript
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
2. Viene emesso il log:
   `[AppCheck] Chiave reCAPTCHA v3 (VITE_RECAPTCHA_V3_SITE_KEY) non configurata. App Check non inizializzato.`
3. In `src/lib/firebase.ts` (righe 56-60):
   ```typescript
   initAppCheck(app).then((res) => {
       if (!res.success) {
           console.warn("App Check fallito o non supportato. App in modalit degradata.", res.reason);
       }
   });
   ```
4. Poiché `res.success` è `false`, viene emesso il secondo log:
   `App Check fallito o non supportato. App in modalit degradata. Chiave reCAPTCHA v3 (VITE_RECAPTCHA_V3_SITE_KEY) non configurata. App Check non inizializzato.`

### 3.2 Scenario B: Ambiente Non Supportato (es. SSR, Browser Obsoleti, jsdom)
- `firebase/app-check` richiede `indexedDB`, Web Crypto API e supporto a iframe sandboxing.
- In `src/lib/appCheck.ts` attuale:
  ```typescript
  export async function isAppCheckSupported(): Promise<boolean> {
      if (isSupportedCached !== null) return isSupportedCached;
      try {
          if (typeof window === 'undefined') {
              isSupportedCached = false;
              return false;
          }
          isSupportedCached = true; // <-- Mancata chiamata a isSupported() dell'SDK
          return isSupportedCached;
      } catch (err) {
          ...
      }
  }
  ```
  `isSupportedCached` viene impostato ciecamente a `true` in qualunque ambiente con `window` (compreso `jsdom` nei test), esponendo `initializeAppCheck` a potenziali errori interni del provider reCAPTCHA v3.

### 3.3 Scenario C: Chiave Presente ma Errore di Rete / Token Scaduto / Dominio non Autorizzato
- `initializeAppCheck` registra `ReCaptchaV3Provider(siteKey)`.
- Se il caricamento dello script di Google reCAPTCHA fallisce (offline, adblock, timeout o dominio non whitelistato nella console reCAPTCHA):
  - Il blocco `try / catch` su `getToken(appCheckInstance, false)` intercetta l'errore senza crashare:
    `console.warn("[AppCheck] Token iniziale non acquisito, il provider riproverà automaticamente:", tokenErr);`
  - Se `initializeAppCheck` solleva un'eccezione costruttore, viene catturata in `catch (err)` restituendo `{ success: false, appCheck: null, isFallbackOffline: true, reason: err?.message }`.
  - In `errorHandler.ts`, i codici di errore di AppCheck (`appcheck/unsupported`, `appcheck/fetch-status-error`, `appcheck/invalid-token`) vengono opportunamente mappati nei codici `ERR_APP_CHECK_UNSUPPORTED` e `ERR_APP_CHECK_BLOCKED` con messaggi user-facing in Italian Sentence case.

---

## 4. Matrice di Comportamento: Stato Attuale vs Stato Desiderato

| Condizione | Stato Attuale | Problema Riscontrato | Stato Desiderato (Clean Fallback) |
|---|---|---|---|
| **Chiave assente / vuota** | `success: false`, `isFallbackOffline: true`, 2x `console.warn` allarmanti. | Falso allarme ("modalità degradata"), rumore nei log e nei test, `fallbackOffline` impostato a `true` anche se online. | `success: true` (o `disabled: true`), `isFallbackOffline: false`, nessun warning. Disabilitazione pulita e trasparente. |
| **Ambiente non supportato** | Verifica incompleta (`typeof window === 'undefined'`). In jsdom `isAppCheckSupported()` dà `true`. | Possibili errori runtime del provider reCAPTCHA in ambienti headless o restrittivi. | Usa `isSupported()` dall'SDK `firebase/app-check`. Se non supportato, disabilita AppCheck in sicurezza con log informativo solo se la chiave era fornita. |
| **Ambiente di sviluppo (`localhost` / `DEV`)** | Imposta `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`. | Funzionale, ma se la chiave manca continua a loggare errori. | Mantenere il debug token se la chiave è configurata, altrimenti disabilitare AppCheck silenziosamente. |
| **Errore acquisizione token / timeout** | Catturato con `console.warn`. Restituisce `success: true` con `appCheck` attivo. | Gestione corretta: il provider effettua retry in background secondo le specifiche Firebase. | Mantenere la resilienza con retry in background del provider Firebase. |

---

## 5. Piano di Implementazione per il Clean Fallback Non Distruttivo

### 5.1 Modifiche Proposte in `src/lib/appCheck.ts`

1. **Importare `isSupported` dall'SDK Firebase:**
   ```typescript
   import { 
       initializeAppCheck, 
       ReCaptchaV3Provider, 
       getToken, 
       type AppCheck,
       type AppCheckToken,
       isSupported as isAppCheckSupportedSdk
   } from 'firebase/app-check';
   ```

2. **Estendere l'interfaccia `AppCheckResult` e `AppCheckStatusDetails`:**
   ```typescript
   export interface AppCheckResult {
       success: boolean;
       appCheck: AppCheck | null;
       isFallbackOffline: boolean;
       disabled?: boolean;
       reason?: string;
   }

   export interface AppCheckStatusDetails {
       initialized: boolean;
       supported: boolean;
       fallbackOffline: boolean;
       hasToken: boolean;
       disabled: boolean;
       tokenExpireTimestamp?: number;
       provider: 'ReCaptchaV3Provider' | 'none';
   }
   ```

3. **Verifica reale del supporto browser in `isAppCheckSupported`:**
   ```typescript
   export async function isAppCheckSupported(): Promise<boolean> {
       if (isSupportedCached !== null) {
           return isSupportedCached;
       }
       try {
           if (typeof window === 'undefined') {
               isSupportedCached = false;
               return false;
           }
           isSupportedCached = await isAppCheckSupportedSdk();
           return isSupportedCached;
       } catch (err) {
           isSupportedCached = false;
           return false;
       }
   }
   ```

4. **Gestione pulita e silenziosa di `siteKey` assente in `initAppCheck`:**
   ```typescript
   export async function initAppCheck(
       app: FirebaseApp, 
       options?: AppCheckInitOptions
   ): Promise<AppCheckResult> {
       const siteKey = options?.siteKey || 
           import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY || 
           import.meta.env.VITE_RECAPTCHA_SITE_KEY;

       // 1. Se la chiave non è configurata, disabilita AppCheck in modo pulito e non distruttivo
       if (!siteKey || siteKey.trim() === '') {
           isFallbackOfflineMode = false;
           return {
               success: true,
               appCheck: null,
               isFallbackOffline: false,
               disabled: true,
               reason: "Chiave reCAPTCHA v3 non configurata. App Check disabilitato."
           };
       }

       // 2. Abilita il debug token in ambiente di sviluppo
       const isDev = Boolean(import.meta.env?.DEV);
       if (typeof window !== 'undefined' && (isDev || options?.debugToken)) {
           // @ts-ignore
           self.FIREBASE_APPCHECK_DEBUG_TOKEN = options?.debugToken ?? true;
       }

       // 3. Verifica supporto browser/runtime
       const supported = await isAppCheckSupported();
       if (!supported) {
           console.info("[AppCheck] Ambiente non supportato da reCAPTCHA v3. App Check disabilitato.");
           isFallbackOfflineMode = false;
           return {
               success: true,
               appCheck: null,
               isFallbackOffline: false,
               disabled: true,
               reason: APP_CHECK_STRINGS.unsupportedMessage
           };
       }

       // 4. Inizializzazione sicura con gestione eccezioni
       try {
           appCheckInstance = initializeAppCheck(app, {
               provider: new ReCaptchaV3Provider(siteKey),
               isTokenAutoRefreshEnabled: options?.isTokenAutoRefreshEnabled ?? true
           });

           try {
               lastToken = await getToken(appCheckInstance, false);
               isFallbackOfflineMode = false;
           } catch (tokenErr) {
               console.warn("[AppCheck] Token iniziale non acquisito, il provider riproverà in background:", tokenErr);
           }

           return {
               success: true,
               appCheck: appCheckInstance,
               isFallbackOffline: false,
               disabled: false
           };
       } catch (err: any) {
           console.error("[AppCheck] Errore durante l'inizializzazione:", err);
           isFallbackOfflineMode = false;
           return {
               success: false,
               appCheck: null,
               isFallbackOffline: false,
               disabled: false,
               reason: err?.message || APP_CHECK_STRINGS.initErrorMessage
           };
       }
   }
   ```

### 5.2 Modifiche Proposte in `src/lib/firebase.ts`

Rimuovere il warning non necessario quando AppCheck è disabilitato:
```typescript
// App Check (ReCaptchaV3Provider)
import { initAppCheck, isAppCheckFallbackOffline } from './appCheck';
initAppCheck(app).then((res) => {
    if (!res.success && !res.disabled) {
        console.warn("App Check non disponibile:", res.reason);
    }
});
```

---

## 6. Correzione Accessoria del Setup di Test (`tests/setup.tsx`)

Durante l'esecuzione di `npm.cmd test`, è emerso che i test falliscono preliminarmente a causa del mock di `firebase/auth` in `tests/setup.tsx`:
- `src/lib/firebase.ts` importa `indexedDBLocalPersistence` da `firebase/auth`.
- `tests/setup.tsx` (riga 153) esportava `browserLocalPersistence: {}` anziché `indexedDBLocalPersistence: {}`.
- Aggiornando il mock in `tests/setup.tsx` aggiungendo `indexedDBLocalPersistence: {}`, tutti i test unitari possono essere eseguiti senza errori di mock mancante.
- Inoltre, con la disabilitazione silenziosa di AppCheck in assenza di chiave, le 70 suite di test non produrranno più alcuno spam di warning in `stderr`.

---

## 7. Verifica e Criteri di Validazione

1. **Assenza di Warning all'Avvio:** 
   - Avviando l'app senza `VITE_RECAPTCHA_V3_SITE_KEY` impostata, nessun avviso `[AppCheck]` o `App in modalità degradata` deve comparire nella console del browser o nel terminale.
2. **Integrità Operativa di Firestore e Auth:**
   - La sincronizzazione dei dati utente, il login/logout e le operazioni di batching continuano a funzionare regolarmente con il database cloud.
3. **Esecuzione Pulita della Test Suite:**
   - Eseguendo `npm.cmd test`, i test vengono eseguiti senza warning spuri di AppCheck in `stderr`.
4. **Comportamento quando la chiave è presente:**
   - Se `VITE_RECAPTCHA_V3_SITE_KEY` viene fornita con un valore valido, AppCheck si inizializza regolarmente con `ReCaptchaV3Provider` e genera i debug token in ambiente `DEV`.
