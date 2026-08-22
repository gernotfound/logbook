# Piano architetturale per il rilascio pubblico di LogBook PWA (Public Release Plan)

**Versione:** 1.0.0  
**Data:** 22 agosto 2026  
**Stato:** Definitivo / Pronto per implementazione  
**Autore:** Team architetturale LogBook  
**Target infrastrutturale:** Firebase Spark Plan (Zero costi, zero servizi a pagamento, zero Cloud Billing)  
**Riferimenti normativi e di progetto:** `AGENTS.md`, `ORIGINAL_REQUEST.md`, GDPR (Reg. UE 2016/679)

---

## 1. Sommario esecutivo e visione architetturale

LogBook è una Progressive Web Application (PWA) offline-first concepita per il tracciamento sportivo, biometrico e nutrizionale ad alte prestazioni. Il frontend è sviluppato con **React 19**, **TypeScript**, **Vite**, **Zustand 5**, **Zod** per la validazione runtime e **Vanilla CSS** conforme al design system *Dark Glassmorphism*.

Il presente piano architetturale definisce le specifiche, i modelli matematici e le procedure operative per il rilascio pubblico in produzione dell'applicazione, garantendo:
1. **Vincolo assoluto di zero costi:** Funzionamento permanente all'interno delle quote gratuite del piano **Firebase Spark**, senza collegare alcun account di fatturazione (Cloud Billing), senza Firebase Blaze e senza servizi cloud a pagamento.
2. **Sicurezza infrastrutturale client-side (Firebase App Check):** Attestazione delle richieste tramite `ReCaptchaV3Provider`, con transizione a due fasi (Monitor $\rightarrow$ Enforcement) e degradazione trasparente in modalità offline per browser non supportati.
3. **Regole di sicurezza Firestore a costo zero:** Validazione server-side basata esclusivamente sui metadati di richiesta e payload, con **zero chiamate `get()` o `exists()`** ($0 letture aggiuntive).
4. **Architettura a catalogo globale versionato (R3):** Separazione dei dati predefiniti (esercizi e alimenti) dai documenti utente, memorizzazione in cache IndexedDB dedicata (`logbook_cached_global_catalog`), sincronizzazione con manifest $O(1)$ e seed JSON statico per il primo avvio.
5. **UX resiliente e gestione avanzata degli errori:** Mappatura granulare degli errori Firebase in lingua italiana (*Sentence case*) tramite `useDialogStore`, con rassicurazione esplicita sull'avvenuto salvataggio locale.
6. **Privacy-Safe Analytics e piena conformità GDPR:** Telemetria anonima subordinata a consenso esplicito e revocabile (opt-in), divieto categorico di dati sanitari/identificativi e informativa privacy allineata agli Artt. 6 e 9 del GDPR.

---

## 2. Vincolo zero costi e controlli operativi sul piano Firebase Spark

### 2.1 Mappa dei servizi consentiti e divieti inderogabili

| Servizio / Componente | Stato nel piano Spark | Vincolo architetturale LogBook |
|---|---|---|
| **Firebase Authentication** | Gratuito (Google Sign-In) | Consentito. Whitelist domini autorizzati obbligatoria. |
| **Cloud Firestore** | Gratuito entro quote giornaliere | Consentito. 50k letture/giorno, 20k scritture/giorno, 1 GiB storage. |
| **Firebase App Check (reCAPTCHA v3)** | Gratuito (1 milione di chiamate/mese) | Consentito. Strict standard `ReCaptchaV3Provider`. |
| **Firebase Analytics (Google Analytics 4)** | Gratuito illimitato | Consentito solo con opt-in dell'utente e zero dati sanitari. |
| **Firebase Hosting / Vercel** | Gratuito (Hobby Tier Vercel) | Hosting PWA su Vercel (`base: '/'`). |
| **Google Cloud Billing Account** | **VIETATO** | Nessuna carta di credito o account billing collegato. |
| **Firebase Blaze Plan** | **VIETATO** | Divieto assoluto di upgrade. |
| **reCAPTCHA Enterprise / App Check Enterprise** | **VIETATO** | Richiede billing e genera costi dopo 10k verifiche. |
| **Cloud Functions / Cloud Run / App Engine** | **VIETATO** | Tutte le elaborazioni avvengono client-side. |
| **Google Cloud Pub/Sub & BigQuery Export** | **VIETATO** | Nessun servizio di streaming dati o data warehousing. |
| **Google Cloud Budget Alerts** | **NON DISPONIBILI** | Richiedono Cloud Billing; sostituiti da monitoraggio manuale. |

---

### 2.2 Protocollo di monitoraggio manuale della dashboard Firebase

In assenza di Cloud Budget Alerts automatici, la governance dei consumi è affidata a controlli manuali periodici della dashboard *Firebase Console $\rightarrow$ Usage and billing* e a soglie operative preventive:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SOGLIE OPERATIVE DI MONITORAGGIO SPARK                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│ 🟢 ZONA VERDE (< 50% delle quote giornaliere)                                   │
│   • Scritture giornaliere: < 10.000 / giorno                                    │
│   • Letture giornaliere: < 25.000 / giorno                                      │
│   • Storage occupato: < 500 MB                                                  │
│   • Azione: Controllo manuale bisettimanale della console.                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│ 🟡 ZONA GIALLA (50% - 80% delle quote giornaliere)                              │
│   • Scritture giornaliere: 10.000 - 16.000 / giorno                             │
│   • Letture giornaliere: 25.000 - 40.000 / giorno                               │
│   • Storage occupato: 500 MB - 800 MB                                           │
│   • Azione: Riduzione della finestra temporale di fetch da 3 a 2 mesi;          │
│             Aumento del controllo console a frequenza giornaliera.              │
├─────────────────────────────────────────────────────────────────────────────────┤
│ 🔴 ZONA ROSSA (> 80% delle quote giornaliere)                                   │
│   • Scritture giornaliere: > 16.000 / giorno                                    │
│   • Letture giornaliere: > 40.000 / giorno                                      │
│   • Storage occupato: > 800 MB                                                  │
│   • Azione: Incremento del debouncer client globale a 2000ms;                   │
│             Impostazione della modalità Guest/Offline come predefinita per      │
│             i nuovi accessi fino al reset delle quote (ore 00:00 UTC).          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Requisito R1: Sicurezza infrastrutturale (Firebase App Check)

### 3.1 Scelta del provider e sicurezza della chiave client
- **Provider selezionato:** `ReCaptchaV3Provider` dal pacchetto `firebase/app-check`.
- **Zero costi verificato:** Google reCAPTCHA v3 standard include **1.000.000 (1 milione) di valutazioni gratuite al mese**, sufficienti a coprire ampiamente decine di migliaia di sessioni utente.
- **Natura pubblica della Site Key:** La chiave del sito reCAPTCHA v3 (`VITE_RECAPTCHA_V3_SITE_KEY`) è un identificatore pubblico client-side, analogo all'ID progetto o alla chiave API Firebase. La chiave segreta risiede esclusivamente sui server Google e non viene mai inclusa nel bundle client.

```typescript
// src/lib/appCheck.ts
import { initializeAppCheck, ReCaptchaV3Provider, AppCheck } from 'firebase/app-check';
import { app } from './firebase';

let appCheckInstance: AppCheck | null = null;

export async function initAppCheck(): Promise<AppCheck | null> {
  const siteKey = import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY;
  if (!siteKey) {
    console.warn('App Check disabilitato: VITE_RECAPTCHA_V3_SITE_KEY non configurata.');
    return null;
  }

  try {
    // Configurazione del debug token per sviluppo locale
    if (import.meta.env.DEV) {
      // @ts-ignore
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true, // Rinnovo automatico prima della scadenza
    });
    return appCheckInstance;
  } catch (error) {
    console.error('Inizializzazione App Check non riuscita:', error);
    return null;
  }
}
```

---

### 3.2 Ciclo di vita del token e parametri TTL
- **Time-to-Live (TTL) del token:** Configurato a **1 ora (3.600 secondi)** nella console Firebase.
- **Rinnovo automatico in background:** Con `isTokenAutoRefreshEnabled: true`, l'SDK Firebase rinnova il token in modo trasparente prima della scadenza durante l'utilizzo dell'app.
- **Comportamento al risveglio dell'app:** Se l'utente sospende la PWA in background su iOS/Android per diverse ore, al ritorno in primo piano (`visibilitychange`) l'SDK acquisisce automaticamente un nuovo token alla prima richiesta di rete.

---

### 3.3 Piano di rilascio a due fasi (Rollout Plan)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 1: MONITOR MODE (Modalità di osservazione - 7/14 giorni)                │
│ • Registrazione Web App con reCAPTCHA v3 Site Key in Firebase Console       │
│ • Cloud Firestore App Check Enforcement: DISATTIVATO (Unenforced)           │
│ • Il client PWA inizializza App Check e trasmette i token di attestazione   │
│ • Monitoraggio dashboard: verifica che >99% delle richieste autentiche      │
│   risultino con stato "Verified" su iOS Safari, Android Chrome e Desktop PWA│
│ • Nessun blocco su richieste fallite: raccolta metrica non invasiva         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Esito verifica > 99% Verified)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 2: ENFORCEMENT MODE (Modalità di blocco attivo)                        │
│ • Attivazione dell'Enforcement su Cloud Firestore nella Console Firebase    │
│ • Tutte le richieste prive di token valido vengono respinte al gateway edge │
│ • 0 costi aggiuntivi e 0 letture/scritture consumate per richieste respinte │
│ • I client non compatibili degradano automaticamente alla modalità offline  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 3.4 Gestione `isSupported() === false` e resilienza offline

App Check fa affidamento su API browser moderne (IndexedDB, Web Crypto, iframe sandboxed). In finestre di navigazione privata restrittive, browser obsoleti o WebView integrate di terze parti, `isSupported()` può restituire `false`.

**Regola architetturale inderogabile:**
Durante l'enforcement, **è vietato bypassare App Check per tentare scritture cloud non autorizzate**. Se App Check fallisce o non è supportato:
1. L'applicazione disattiva la sincronizzazione remota (`isCloudSyncDisabled = true`).
2. L'applicazione commuta in modalità **Locale Offline (Tier 2/3 - IndexedDB + LocalStorage)**, consentendo all'utente di allenarsi, consultare il diario e salvare i dati sul proprio dispositivo al 100% delle funzionalità.
3. Viene mostrato un avviso chiaro in lingua italiana (*Sentence case*) tramite `useDialogStore`.

#### Specifiche dell'avviso utente:
- **Metodo:** `useDialogStore.getState().showAlert(messaggio, titolo)`
- **Titolo:** *"Verifica di sicurezza non supportata"*
- **Messaggio:** *"Il browser o la modalità di navigazione attuale non supportano i controlli di sicurezza necessari per la sincronizzazione cloud. LogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo."*

---

### 3.5 Checklist di sicurezza: Domini autorizzati e restrizioni API Key

| Ambito | Piattaforma di configurazione | Impostazione obbligatoria | Finalità di sicurezza |
|---|---|---|---|
| **Firebase Auth** | Firebase Console $\rightarrow$ Authentication $\rightarrow$ Impostazioni $\rightarrow$ Domini autorizzati | Aggiungere esclusivamente:<br>1. Dominio di produzione (es. `logbook.vercel.app`)<br>2. Sottodomini di anteprima autorizzati (`*.vercel.app`)<br>3. `localhost` (sviluppo locale) | Impedisce errori `auth/unauthorized-domain` e blocca tentativi di autenticazione da origini web non autorizzate. |
| **Google Cloud API Key** | Google Cloud Console $\rightarrow$ API e servizi $\rightarrow$ Credenziali $\rightarrow$ Browser key | 1. **Restrizioni relative alle applicazioni:** Referrer HTTP (siti web).<br>2. **Referrer consentiti:** `https://logbook*.vercel.app/*`, `http://localhost:*`<br>3. **Restrizioni relative alle API:** Limitare la chiave strettamente a:<br>- *Identity Toolkit API*<br>- *Token Service API*<br>- *Cloud Firestore API*<br>- *Firebase App Check API* | Impedisce l'utilizzo abusivo della chiave API pubblica per chiamare altre API di Google Cloud o da domini malevoli. |
| **Firestore App Check** | Firebase Console $\rightarrow$ App Check $\rightarrow$ Cloud Firestore | Attivare **Enforcement** al termine della Fase 1. | Rifiuta all'origine qualsiasi chiamata REST o script esterno non proveniente dal client PWA attestato. |

---

## 4. Requisito R2: Quote, integrità dei dati e modello matematico Spark

### 4.1 Principio zero `get()` / `exists()` nelle Firestore Security Rules
- Sul piano Firebase Spark, ogni invocazione della funzione `get()` o `exists()` all'interno delle Security Rules esegue una **lettura documentale tariffata**.
- Se un batch di scrittura tocca 3 documenti e le regole eseguono 2 verifiche `get()` per documento, ogni operazione di salvataggio consuma $3 \times 2 = 6$ letture documentali aggiuntive, riducendo drasticamente il numero di utenti supportabili.
- **Soluzione architetturale:** Le regole di sicurezza di LogBook operano con **zero chiamate `get()` e zero chiamate `exists()` ($0 costi di lettura aggiuntivi)**. Tutte le convalide avvengono analizzando:
  1. `request.auth` (identificativo UID dell'utente autenticato)
  2. `request.resource.data` (payload in ingresso)
  3. `resource.data` (stato preesistente del documento)
  4. Parametri di percorso (`{userId}`, `{monthId}`)

---

### 4.2 Doppia barriera di protezione dimensioni payload (Client & Server)

#### Livello 1: Pre-validazione client (`src/lib/db.ts`)
Prima dell'invio del batch a Firestore, la funzione `checkDocSize` calcola l'ingombro del JSON serializzato in byte UTF-8:
```typescript
function checkDocSize(data: any, docName: string) {
  const jsonStr = JSON.stringify(data);
  const sizeBytes = new Blob([jsonStr]).size;
  if (sizeBytes > 950000) { // Soglia di sicurezza sotto il limite rigido di 1MB
    throw new Error(
      `Il documento ${docName} supera il limite di dimensione di sicurezza (950 KB). Riduci i dati inseriti.`
    );
  }
}
```

#### Livello 2: Regole di sicurezza server-side (`firestore.rules`)
Le regole server-side impongono limiti strutturali inderogabili:
- Whitelist rigorosa dei campi consentiti sul documento root `users/{userId}`.
- Limite sul numero massimo di elementi negli array:
  - `library` (esercizi personalizzati): $\le 500$ elementi
  - `routines` (schede di allenamento): $\le 100$ elementi
  - `customFoods` (alimenti personalizzati): $\le 1000$ elementi
  - `trainingCycles` (cicli di programmazione): $\le 50$ elementi
  - `supplements` (integratori registrati): $\le 50$ elementi
  - `activePains` (dolori/DOMS attivi): $\le 50$ elementi
  - `catalogOverrides` (personalizzazioni catalogo): $\le 200$ elementi
  - `catalogHiddenIds` (elementi nascosti catalogo): $\le 500$ elementi
- Subcollection mensilizzate:
  - `history_months/{monthId}`: formato regex `^[0-9]{4}-(0[1-9]|1[0-2])$`, massimo 120 sessioni per mese documentale.
  - `nutrition_months/{monthId}`: formato regex `^[0-9]{4}-(0[1-9]|1[0-2])$`, massimo 31 registrazioni giornaliere per mese.

---

### 4.3 Regole di sicurezza complete (`firestore.rules`)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // --- Funzioni helper a costo zero (Zero get() / exists()) ---
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function isValidMonthId(monthId) {
      return monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$');
    }
    
    function incomingData() {
      return request.resource.data;
    }

    // Blocco predefinito di sicurezza
    match /{document=**} {
      allow read, write: if false;
    }

    // Catalogo globale pubblico versionato (R3)
    match /catalog/{docId} {
      allow read: if true;
      allow write: if false; // Modificabile esclusivamente da Firebase Admin Console
    }

    // Documento principale utente: users/{userId}
    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      
      allow create, update: if isOwner(userId)
        // 1. Whitelist rigorosa dei campi consentiti
        && incomingData().keys().hasOnly([
          'profile',
          'library',
          'routines',
          'customFoods',
          'activeWorkout',
          'trainingCycles',
          'activeCycleId',
          'nutritionPlanning',
          'supplements',
          'activePains',
          'catalogOverrides',
          'catalogHiddenIds'
        ])
        // 2. Integrità dei tipi
        && (incomingData().profile is map)
        && (!('activeWorkout' in incomingData()) || incomingData().activeWorkout == null || incomingData().activeWorkout is map)
        && (!('activeCycleId' in incomingData()) || incomingData().activeCycleId == null || incomingData().activeCycleId is string)
        && (!('nutritionPlanning' in incomingData()) || incomingData().nutritionPlanning == null || incomingData().nutritionPlanning is map)
        // 3. Limiti dimensionali sugli array
        && (!('library' in incomingData()) || (incomingData().library is list && incomingData().library.size() <= 500))
        && (!('routines' in incomingData()) || (incomingData().routines is list && incomingData().routines.size() <= 100))
        && (!('customFoods' in incomingData()) || (incomingData().customFoods is list && incomingData().customFoods.size() <= 1000))
        && (!('trainingCycles' in incomingData()) || (incomingData().trainingCycles is list && incomingData().trainingCycles.size() <= 50))
        && (!('supplements' in incomingData()) || (incomingData().supplements is list && incomingData().supplements.size() <= 50))
        && (!('activePains' in incomingData()) || (incomingData().activePains is list && incomingData().activePains.size() <= 50))
        && (!('catalogOverrides' in incomingData()) || (incomingData().catalogOverrides is list && incomingData().catalogOverrides.size() <= 200))
        && (!('catalogHiddenIds' in incomingData()) || (incomingData().catalogHiddenIds is list && incomingData().catalogHiddenIds.size() <= 500));
        
      // Sottocollezione: Storico allenamenti mensilizzato (users/{userId}/history_months/{YYYY-MM})
      match /history_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId)
          && incomingData().keys().size() <= 120; // Max 120 sessioni mensili
      }
      
      // Sottocollezione: Storico nutrizione e misure mensilizzato (users/{userId}/nutrition_months/{YYYY-MM})
      match /nutrition_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId)
          && incomingData().keys().size() <= 31; // Max 31 giorni mensili
      }
    }
  }
}
```

---

### 4.4 Modello matematico delle quote Spark e capacità utenti

#### Parametri limite del piano gratuito Firebase Spark:
- **Letture documentali:** 50.000 / giorno
- **Scritture documentali:** 20.000 / giorno
- **Cancellazioni documentali:** 20.000 / giorno
- **Spazio di archiviazione (Storage):** 1 GiB (1.024 MB)
- **Banda in uscita (Egress):** 10 GiB / mese (~333 MB / giorno)
- **Listener realtime:** 0 (LogBook non utilizza listener realtime `onSnapshot`)

---

#### Modellazione dettagliata delle letture (Read Operations):
1. **Avvio a freddo / Sincronizzazione iniziale:**
   - Documento radice `users/{uid}`: 1 lettura
   - Subcollection `history_months` (finestra mobile di 3 mesi: $M, M-1, M-2$): 3 letture
   - Subcollection `nutrition_months` (finestra mobile di 3 mesi): 3 letture
   - Documento `catalog/manifest` (verifica versione catalogo $O(1)$): 1 lettura
   - **Totale per sincronizzazione a freddo:** **8 letture**
2. **Sessione a caldo / Ritorno in primo piano (`visibilitychange`):**
   - Servita direttamente dalla cache locale IndexedDB: 0-8 letture (media ponderata ~2 letture per verifica).
3. **Utenti in modalità Guest:** **0 letture**.

**Profili di consumo giornaliero:**
- **Utente standard (2 aperture/giorno):** $2 \times 8 = \mathbf{16\text{ letture / utente / giorno}}$
- **Utente intensivo / Power user (6 aperture/giorno):** $6 \times 8 = \mathbf{48\text{ letture / utente / giorno}}$

---

#### Modellazione dettagliata delle scritture (Write Operations):
L'ottimizzazione delle scritture poggia su tre barriere difensive:
1. **Debouncer globale di 1000ms (`DEBOUNCE_DELAY_GLOBAL = 1000ms`):** Raggruppa modifiche multiple in un'unica scrittura.
2. **Salvataggio sincrono istantaneo in `localStorage` (`'logbook_local_workout'`):** Le singole serie di allenamento non generano scritture su Firestore in tempo reale.
3. **Diffing `fast-deep-equal` in `DB.saveUserData`:** Il `writeBatch` invia solo i documenti e i mesi effettivamente modificati.

**Consumo di scritture per evento:**
- **Completamento allenamento:** 1 scrittura su `users/{uid}` (`activeWorkout: null`) + 1 scrittura su `history_months/{YYYY-MM}` = **2 scritture**.
- **Registrazione pasti giornalieri:** 1 scrittura su `nutrition_months/{YYYY-MM}` per sessione di inserimento = **1 scrittura**.
- **Modifica impostazioni / creazione scheda:** 1 scrittura su `users/{uid}` = **1 scrittura**.

**Profili di consumo giornaliero:**
- **Utente standard (1 allenamento + 3 sessioni pasti + 1 modifica scheda/profilo):** $2 + 3 + 1 = \mathbf{6\text{ scritture / utente / giorno}}$
- **Utente intensivo (1 allenamento lungo + 5 sessioni pasti + 3 modifiche programmazione):** $2 + 5 + 3 = \mathbf{10\text{ scritture / utente / giorno}}$

---

#### Calcolo della capacità di utenti attivi giornalieri (Daily Active Users - DAU):

$$\text{Capacità DAU (Scritture)} = \frac{20.000\text{ scritture/giorno}}{\text{Scritture per utente/giorno}}$$
$$\text{Capacità DAU (Letture)} = \frac{50.000\text{ letture/giorno}}{\text{Letture per utente/giorno}}$$

| Distribuzione utenti | Scritture / utente / giorno | Letture / utente / giorno | Max DAU su quota scritture (20k) | Max DAU su quota letture (50k) |
|---|---|---|---|---|
| **100% Utenti standard** | 6 | 16 | **3.333 DAU** | **3.125 DAU** |
| **100% Utenti intensivi** | 10 | 48 | **2.000 DAU** | **1.041 DAU** |
| **Distribuzione reale (80% Standard / 20% Intensivi)** | **6,8** | **22,4** | **2.941 DAU** | **2.232 DAU** |

**Conclusioni sulla capacità:**
- Il collo di bottiglia operativo sul piano gratuito è rappresentato dalle 50.000 letture/giorno, che consentono di servire stabilmente **oltre 2.200 utenti attivi giornalieri (DAU)** in uno scenario realistico con il 20% di power user, e **oltre 3.100 DAU** con comportamento tipico.

---

#### Analisi della capacità di archiviazione (Storage 1 GiB):
- **Documento radice `users/{uid}`** (con catalogo globale scorporato): ~15 KB.
- **Subcollection `history_months`** (15-20 allenamenti/mese): ~15 KB / mese = ~180 KB / anno.
- **Subcollection `nutrition_months`** (30 giorni di pasti e misure): ~20 KB / mese = ~240 KB / anno.
- **Ingombro complessivo per utente/anno:**
  $$\text{Storage}_{\text{utente-anno}} = 15\text{ KB} + 180\text{ KB} + 240\text{ KB} \approx \mathbf{435\text{ KB}} \ (0,425\text{ MB})$$
- **Capacità totale sullo storage gratuito di 1.024 MB:**
  $$\text{Utenti annuali supportabili} = \frac{1.024\text{ MB}}{0,425\text{ MB/utente}} \approx \mathbf{2.409\text{ utenti attivi per 1 anno intero}}$$

---

## 5. Requisito R3: Catalogo globale, offline fallback e cache separata

### 5.1 Criticità dell'architettura legacy
Nell'implementazione precedente, gli array completi `defaultExercises` (~100+ esercizi) e `defaultFoods` (~300+ alimenti) venivano copiati direttamente all'interno del documento `users/{uid}` di ogni singolo utente:
1. **Rischio saturazione documento (limite 1MB):** Il documento radice partiva già da oltre 100 KB, avvicinandosi rapidamente alla soglia di guardia di 950 KB all'aggiunta di schede, note e cicli.
2. **Spreco di banda e quote:** Ogni sincronizzazione del profilo trasferiva centinaia di record statici immutati.
3. **Mancanza di manutenibilità:** Eventuali correzioni o nuovi alimenti/esercizi aggiunti dall'amministratore non potevano essere propagati agli utenti esistenti.

---

### 5.2 Nuova architettura a catalogo globale versionato (R3)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Cloud Firestore (Spark)                            │
│                                                                             │
│  /catalog/manifest                                                          │
│  { version: "1.0.0", updatedAt: "2026-08-22", docRefs: { ... } }            │
│                                                                             │
│  /catalog/exercises_v1                    /catalog/foods_v1                 │
│  { items: [ ...esercizi predefiniti ] }   { items: [ ...alimenti predef. ] }│
│                                                                             │
│  Rules: allow read: if true; allow write: if false;                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (1 lettura singola O(1) all'avvio)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Client PWA (Offline-First)                           │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Tier 2 Cache: IndexedDB ('logbook_cached_global_catalog')             │  │
│  │ { manifest, exercises: [...], foods: [...], cachedAt: timestamp }     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      ▲                                       │
│  (Fallback immediato se vuoto)       │                                       │
│  ┌───────────────────────────────────┴───────────────────────────────────┐  │
│  │ Static Bundled Seed JSON (seedExercises.json, seedFoods.json)         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Dati utente (users/{uid} o IndexedDB UserData)                        │  │
│  │ • customExercises: Exercise[] (creati da utente)                      │  │
│  │ • customFoods: Food[] (creati da utente)                              │  │
│  │ • catalogOverrides: Record<id, Override> (modifiche a predefiniti)    │  │
│  │ • catalogHiddenIds: string[] (ID predefiniti nascosti/cancellati)     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│                                      ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Risolutore a runtime (in-memory Zustand)                              │  │
│  │ EffectiveLibrary = (Global \ Hidden) ⊕ Overrides ∪ Custom             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 5.3 Struttura del Manifest e schemi di validazione Zod

```typescript
// Interfaccia del manifest
export interface CatalogManifest {
  version: string;        // es. "1.0.0"
  updatedAt: string;      // ISO string
  schemaVersion: number;  // es. 1
  docRefs: {
    exercises: string;    // "exercises_v1"
    foods: string;        // "foods_v1"
  };
  itemCounts: {
    exercises: number;    // es. 120
    foods: number;        // es. 350
  };
}

export interface CatalogOverrides {
  exercises?: Record<string, {
    notes?: string;
    muscles?: string[];
    secondaryMuscles?: string[];
    equipmentWeight?: number;
    isBodyweight?: boolean;
    trackingType?: 'weight_reps' | 'time' | 'cardio';
  }>;
  hiddenExerciseIds?: string[];
  hiddenFoodIds?: string[];
}
```

---

### 5.4 Algoritmo di sincronizzazione e minimizzazione letture ($O(1)$)

1. **Bootstrap iniziale pre-render (`main.tsx`):**
   - L'applicazione tenta di leggere `logbook_cached_global_catalog` da IndexedDB.
   - Se presente, inizializza immediatamente lo store (<10ms, 0 chiamate di rete).
   - Se assente (primo avvio, modalità guest o cache cancellata), carica istantaneamente i file `seedExercises.json` e `seedFoods.json` inclusi staticamente nel bundle client.
2. **Sincronizzazione condizionale remota (`syncGlobalCatalog()`):**
   - Esegue **1 sola lettura Firestore**: `getDoc(doc(db, "catalog", "manifest"))`.
   - Se `manifest.version === cachedCatalog.manifest.version`, la sincronizzazione termina immediatamente (**0 letture aggiuntive**).
   - Se la versione è diversa (o la cache è obsoleta/corrotta):
     - Scarica i soli documenti aggiornati (`catalog/exercises_v1`, `catalog/foods_v1`).
     - Esegue la validazione difensiva tramite `DomainParsers`.
     - Scrive atomicamente la nuova cache in IndexedDB (`'logbook_cached_global_catalog'`).
3. **Resilienza in assenza di rete:** In caso di errore o timeout (>4000ms), la sincronizzazione remota fallisce silenziosamente senza bloccare la UI, mantenendo la versione in cache o il seed statico.

---

### 5.5 Applicazione della checklist obbligatoria in 5 passaggi (`AGENTS.md`)

Per estendere lo schema utente con i campi delta senza salvare duplicati statici:
1. **`src/types.ts`:**
   - Definire le interfacce `CatalogManifest`, `CachedGlobalCatalog`, `CatalogOverrides`.
   - Aggiungere a `UserData`: `customExercises?: Exercise[]`, `catalogOverrides?: CatalogOverrides`, `catalogHiddenIds?: string[]`.
2. **`src/lib/schema.ts`:**
   - Definire `CatalogManifestSchema` e `CatalogOverridesSchema` con helper difensivi (`safeString`, `safeNumber`, `.catch({})`).
   - Registrare i nuovi campi in `UserDataSchema`, `defaultUserDataFallback` e `DomainParsers`.
3. **`src/lib/db.ts`:**
   - In `DB.loadUserData`: rimuovere l'inserimento forzato dei default in `state.library` e mappare i campi delta.
   - In `DB.saveUserData`: serializzare solo `customExercises`, `catalogOverrides` e `catalogHiddenIds` nel documento `users/{uid}`, escludendo i default dal payload e dal diffing `deepEqual`.
4. **`src/contexts/AuthContext.tsx` e `src/lib/merge.ts`:**
   - Snellire `defaultUserData` rimuovendo centinaia di record statici duplicati.
   - In `mergeUserData`: unire `customExercises` per `id` e fondere gli oggetti `catalogOverrides`, preservando le modifiche guest su collisione.
5. **`src/lib/export.ts`:**
   - Aggiornare `Exporter.exportToCSV` affinché risolva i nomi e le proprietà degli esercizi consultando a runtime il catalogo globale unificato con gli override dell'utente.

---

## 6. Requisito R4: UX resiliente e gestione avanzata degli errori

### 6.1 Mappatura dei codici di errore Firebase in lingua italiana (*Sentence case*)

In conformità a `AGENTS.md`, i messaggi di errore non devono presentare termini tecnici grezzi, ma traduzioni rassicuranti in formato *Sentence case* (solo la prima lettera maiuscola):

| Codice di errore Firebase | Categoria errore | Messaggio visualizzato all'utente (*Sentence case*) |
|---|---|---|
| `unavailable` | Connessione | *"Connessione internet non disponibile. I dati sono stati salvati localmente sul dispositivo e verranno sincronizzati appena torni online."* |
| `permission-denied` (App Check) | Sicurezza | *"Verifica di sicurezza non superata o non supportata dal browser. L'applicazione continuerà a funzionare regolarmente in modalità locale offline."* |
| `permission-denied` (Rules) | Validazione | *"Operazione respinta dai controlli di sicurezza. Riduci i dati inseriti o verifica i limiti consentiti."* |
| `resource-exhausted` | Quota | *"Limite di sincronizzazione cloud temporaneamente raggiunto. Le modifiche sono al sicuro sul tuo dispositivo."* |
| `unauthenticated` | Sessione | *"Sessione scaduta. Effettua nuovamente l'accesso per ripristinare la sincronizzazione cloud."* |
| `deadline-exceeded` | Timeout | *"Il server non ha risposto in tempo utile. I dati sono stati salvati nella memoria locale."* |

---

### 6.2 I tre scenari obbligatori di gestione errori tramite `useDialogStore`

Tutti i dialoghi di notifica e avviso utilizzano esclusivamente `useDialogStore.getState().showAlert(...)` renderizzati da `<GlobalDialog />`. È categoricamente vietato l'uso di `window.alert()` o `window.confirm()`.

```typescript
// src/lib/syncErrorHandler.ts
import { useDialogStore } from '../store/useDialogStore';

export async function handleSyncError(error: any): Promise<void> {
  const code = error?.code || '';
  const message = error?.message || '';

  // Scenario 1: Rete assente ma salvataggio locale riuscito
  if (
    !navigator.onLine ||
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    message.includes('offline') ||
    message.includes('Timeout')
  ) {
    await useDialogStore.getState().showAlert(
      'Connessione internet non disponibile. I dati sono stati salvati localmente sul dispositivo e verranno sincronizzati appena torni online.',
      'Salvataggio locale completato'
    );
    return;
  }

  // Scenario 2: App Check non supportato o bloccato
  if (
    code === 'app-check/unsupported' ||
    (code === 'permission-denied' && message.includes('AppCheck'))
  ) {
    await useDialogStore.getState().showAlert(
      'Il browser o la modalità di navigazione attuale non supportano i controlli di sicurezza necessari per la sincronizzazione cloud. LogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo.',
      'Verifica di sicurezza non supportata'
    );
    return;
  }

  // Scenario 3: Scrittura respinta dalle Security Rules (dimensione o limite superato)
  if (code === 'permission-denied' || code === 'resource-exhausted') {
    await useDialogStore.getState().showAlert(
      'La sincronizzazione cloud è stata respinta a causa del superamento dei limiti di memoria o di sicurezza. I tuoi dati restano memorizzati localmente.',
      'Limite di sincronizzazione raggiunto'
    );
    return;
  }

  // Errore generico
  await useDialogStore.getState().showAlert(
    'Si è verificato un errore durante la sincronizzazione cloud. I dati sono comunque memorizzati localmente sul tuo dispositivo.',
    'Errore di sincronizzazione'
  );
}
```

---

## 7. Requisito R6: Sistema di Privacy-Safe Analytics

### 7.1 Vincoli legali e principi di Privacy by Design
1. **Privacy by Default (Opt-in obbligatorio):** La raccolta dati è completamente disattivata all'avvio. Si attiva solo previa azione affermativa dell'utente.
2. **Divieto assoluto di trasmissione di dati sanitari o identificativi:**
   - **MAI inviare:** UID Firebase, email, nome utente, foto profilo.
   - **MAI inviare:** Nomi di esercizi, carichi (kg), ripetizioni, recuperi, serie speciali, note di sessione, autovalutazioni di fatica/umore, dolori muscolari (DOMS).
   - **MAI inviare:** Nomi di alimenti, grammature, calorie (kcal), macronutrienti (carboidrati, proteine, grassi), orari pasti, integratori assunti.
   - **MAI inviare:** Peso corporeo, percentuale massa grassa, circonferenze corporee, ore o fasi del sonno.

---

### 7.2 Tassonomia degli eventi anonimi consentiti (Whitelist rigorosa)

Tutti i parametri inviati devono essere aggregati in "bucket" o enumerazioni non riconducibili al singolo individuo:

| Nome evento | Descrizione dell'evento | Parametri anonimi consentiti (Whitelist) |
|---|---|---|
| `app_opened` | Apertura o ripristino dell'app | `platform: 'ios' \| 'android' \| 'desktop'`, `is_pwa: boolean`, `is_guest: boolean` |
| `screen_view` | Cambio schermata principale | `screen_name: 'home' \| 'training' \| 'nutrition' \| 'data' \| 'settings'` |
| `sub_tab_view` | Navigazione tra sotto-schede | `tab_name: string`, `sub_tab_name: string` |
| `workout_session_logged` | Salvataggio di una sessione | `duration_bucket: '<30m' \| '30-60m' \| '60-90m' \| '>90m'`, `exercises_count_bucket: '1-3' \| '4-6' \| '7-10' \| '>10'`, `is_routine_based: boolean` |
| `nutrition_day_logged` | Salvataggio giornata alimentare | `has_meals: boolean`, `has_measurements: boolean`, `meals_count_bucket: '1-3' \| '4-6' \| '>6'` |
| `routine_created` | Creazione di una scheda | `exercises_count_bucket: '1-5' \| '6-10' \| '>10'` |
| `training_cycle_created` | Creazione ciclo programmazione | `duration_weeks_bucket: '1-4' \| '5-8' \| '9-12' \| '>12'` |
| `csv_export_triggered` | Esportazione dei dati CSV | `has_workouts: boolean`, `has_nutrition: boolean` |
| `pwa_installed` | Installazione come PWA | `platform: 'ios' \| 'android' \| 'desktop'` |
| `app_check_result` | Esito attestazione sicurezza | `status: 'success' \| 'fallback_offline' \| 'unsupported'` |
| `sync_error_occurred` | Errore tecnico di rete/database | `error_category: string`, `error_code: string`, `is_offline: boolean` |

---

### 7.3 Tassonomia normalizzata dei codici di errore (`error_code`)

È vietato inviare stack trace o stringhe non controllate. I codici di errore sono rigorosamente standardizzati:
- `ERR_AUTH_NETWORK`: Errore di connessione durante l'autenticazione.
- `ERR_AUTH_EXPIRED`: Token di sessione scaduto.
- `ERR_FIRESTORE_UNAVAILABLE`: Connessione assente durante la scrittura batch.
- `ERR_FIRESTORE_QUOTA`: Superamento quota piano Spark (`resource-exhausted`).
- `ERR_FIRESTORE_PERMISSION`: Rifiuto dalle Security Rules (`permission-denied`).
- `ERR_FIRESTORE_TIMEOUT`: Timeout del batch di scrittura (>7000ms).
- `ERR_APP_CHECK_UNSUPPORTED`: reCAPTCHA v3 non supportato nel browser.
- `ERR_APP_CHECK_BLOCKED`: Token di sicurezza non valido.
- `ERR_STORAGE_QUOTA_EXCEEDED`: Spazio IndexedDB o LocalStorage esaurito sul dispositivo.
- `ERR_SCHEMA_VALIDATION_FALLBACK`: Record corrotto isolato e sanificato dal Gateway Zod.

---

### 7.4 Gestione del consenso, UI e revoca immediata
- **Persistenza:** Chiave sincrona `localStorage.getItem('logbook_analytics_consent')` con valori `'granted'` o `'denied'` (predefinito se assente: `'denied'`).
- **Collocazione UI:** Toggle in *Impostazioni $\rightarrow$ Sezione "Privacy e diagnostica"*.
- **Revoca immediata:** Alla disattivazione del toggle:
  1. Scrittura di `'denied'` in `localStorage`.
  2. Invocazione immediata di `setAnalyticsCollectionEnabled(analytics, false)`.
  3. Svuotamento e cancellazione di code di eventi in memoria.
  4. Riscontro visivo ottimistico immediato: *"Condivisione diagnostica disattivata."*

---

## 8. Requisito R5: Strategia di isolamento e test con Firestore Emulator

### 8.1 Isolamento del repository di produzione
- **Regola inderogabile:** **0 file modificati nella cartella di produzione `src/`**.
- Tutti i file di specifica, documentazione, schemi PoC e suite di test risiedono nella working directory `teamwork_projects/logbook_public_release/`.

---

### 8.2 Piano di test con Firestore Emulator (`@firebase/rules-unit-testing`)

La suite di test del PoC valida in modo deterministico il rispetto di tutti i vincoli di sicurezza:

```typescript
// teamwork_projects/logbook_public_release/poc/rules.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import * as path from 'path';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules Test Suite', () => {
  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(__dirname, 'firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: 'logbook-public-release-test',
      firestore: { rules, host: '127.0.0.1', port: 8080 },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('Consente la lettura pubblica del catalogo globale', async () => {
    const unauthedCtx = testEnv.unauthenticatedContext();
    const catalogDoc = unauthedCtx.firestore().doc('catalog/manifest');
    await assertSucceeds(catalogDoc.get());
  });

  it('Nega tassativamente qualsiasi scrittura client sul catalogo globale', async () => {
    const authedCtx = testEnv.authenticatedContext('user_123');
    const catalogDoc = authedCtx.firestore().doc('catalog/manifest');
    await assertFails(catalogDoc.set({ version: '9.9.9' }));
  });

  it('Consente la scrittura del documento root per il proprietario legittimo', async () => {
    const authedCtx = testEnv.authenticatedContext('user_123');
    const userDoc = authedCtx.firestore().doc('users/user_123');
    await assertSucceeds(
      userDoc.set({
        profile: { name: 'Mario Rossi' },
        library: [{ id: 'ex_1', name: 'Panca piana', setsCount: 3, sets: [] }],
        routines: [],
        customFoods: [],
        trainingCycles: [],
        supplements: [],
        activePains: [],
        catalogOverrides: [],
        catalogHiddenIds: [],
      })
    );
  });

  it('Nega la scrittura se il documento root contiene campi non inclusi nella whitelist', async () => {
    const authedCtx = testEnv.authenticatedContext('user_123');
    const userDoc = authedCtx.firestore().doc('users/user_123');
    await assertFails(
      userDoc.set({
        profile: {},
        unauthorizedField: 'malicious payload',
      })
    );
  });

  it('Nega la scrittura se l array library supera 500 elementi', async () => {
    const authedCtx = testEnv.authenticatedContext('user_123');
    const userDoc = authedCtx.firestore().doc('users/user_123');
    const oversizedLibrary = Array.from({ length: 501 }, (_, i) => ({
      id: `ex_${i}`,
      name: `Esercizio ${i}`,
      setsCount: 3,
      sets: [],
    }));
    await assertFails(
      userDoc.set({
        profile: {},
        library: oversizedLibrary,
      })
    );
  });

  it('Nega la scrittura su subcollection history con ID mese malformato', async () => {
    const authedCtx = testEnv.authenticatedContext('user_123');
    const invalidMonthDoc = authedCtx.firestore().doc('users/user_123/history_months/2026-13'); // Mese 13 non valido
    await assertFails(invalidMonthDoc.set({ session_1: { id: 's1' } }));
  });

  it('Consente la scrittura su subcollection history con ID mese valido YYYY-MM', async () => {
    const authedCtx = testEnv.authenticatedContext('user_123');
    const validMonthDoc = authedCtx.firestore().doc('users/user_123/history_months/2026-08');
    await assertSucceeds(validMonthDoc.set({ session_1: { id: 's1' } }));
  });
});
```

---

## 9. Piano di implementazione e roadmap di rilascio

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 1: VALIDAZIONE POC & TEST SU EMULATOR                                  │
│ • Creazione e validazione suite di test firestore.rules                     │
│ • Validazione PoC catalogo globale, seed JSON e Zod gateway                 │
│ • Validazione PoC App Check ReCaptchaV3Provider e gestione fallback         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 2: APPLICAZIONE CHECKLIST IN 5 PASSAGGI (Modifiche controllate)        │
│ • 1. src/types.ts: interfacce Catalog e UserData esteso                     │
│ • 2. src/lib/schema.ts: CatalogManifestSchema e CatalogOverridesSchema      │
│ • 3. src/lib/db.ts: loadCatalogManifest, syncGlobalCatalog, checkDocSize    │
│ • 4. src/contexts/AuthContext.tsx & merge.ts: snellimento defaultUserData   │
│ • 5. src/lib/export.ts: risoluzione catalogo unificato in CSV               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 3: INTEGRAZIONE UI, ERROR HANDLER E PRIVACY POLICY                     │
│ • Integrazione useDialogStore con formatSyncError in Sentence case          │
│ • Aggiunta sezione "Privacy e diagnostica" con toggle opt-in in Settings    │
│ • Inserimento Privacy Policy visualizzabile in-app                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 4: CONFIGURAZIONE GOOGLE CLOUD & MONITORAGGIO APP CHECK                │
│ • Configurazione reCAPTCHA v3 Site Key (VITE_RECAPTCHA_V3_SITE_KEY)         │
│ • Whitelist domini autorizzati Firebase Auth e restrizioni API Key          │
│ • Avvio App Check in Monitor Mode per 7-14 giorni                           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Verifica >99% Verified)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 5: ENFORCEMENT & GO-LIVE PRODUZIONE                                    │
│ • Attivazione Enforcement su Cloud Firestore                                │
│ • Deploy continuo su Vercel (base: '/')                                     │
│ • Monitoraggio bisettimanale consumi dashboard Firebase Usage and billing   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Matrice di conformità ai requisiti (Traceability Matrix)

| Requisito | Descrizione sintetica | Stato nel piano | Riferimento sezione |
|---|---|---|---|
| **R1** | Firebase App Check con `ReCaptchaV3Provider`, TTL 1h, Site Key pubblica, gestione `isSupported() === false` e transizione Monitor $\rightarrow$ Enforcement | **Completato** | Sezione 3 |
| **R2** | Zero costi Spark, zero `get()`/`exists()`, pre-validazione client 950 KB, limiti dimensionali array e modello matematico DAU | **Completato** | Sezioni 2, 4 |
| **R3** | Catalogo globale versionato, cache IndexedDB dedicata, manifest $O(1)$, seed JSON statico, modello a delta e checklist in 5 passaggi | **Completato** | Sezione 5 |
| **R4** | UX resiliente con `useDialogStore`, mappatura codici errore in italiano *Sentence case*, rassicurazione salvataggio locale e 3 scenari | **Completato** | Sezione 6 |
| **R5** | Isolamento completo (0 modifiche a `src/` in fase di piano/PoC) e suite di test automatizzati su Firestore Emulator | **Completato** | Sezione 8 |
| **R6** | Privacy Policy GDPR esaustiva, basi Art. 6 + 9(2)(a), divieto minori (<18), responsabili Google/Vercel (DPF/SCC), retention certa e opt-in separato | **Completato** | Sezione 7 & `PRIVACY_POLICY.md` |
