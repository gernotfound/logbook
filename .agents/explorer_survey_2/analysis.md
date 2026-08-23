# Analysis & Architectural Design: Security, App Check & Firebase Spark Quota Model

**Author**: Explorer Survey 2 (Security & Spark Quota Specialist)  
**Date**: 2026-08-22  
**Target Application**: LogBook PWA  
**Constraints**: Firebase Spark Tier (Strict Zero-Cost, No Cloud Billing, No Blaze, No reCAPTCHA Enterprise, No Cloud Functions)

---

## 1. Firebase App Check & Client-Side Web Security Architecture

### 1.1 Provider Selection & Zero-Cost Justification
- **Selected Provider**: `ReCaptchaV3Provider` from `firebase/app-check`.
- **Zero-Cost Verification**: Google reCAPTCHA v3 standard tier provides **1,000,000 (1 million) free evaluations per month**, which completely satisfies the zero-cost constraint.
- **Strict Prohibition**: `reCAPTCHA Enterprise` and `AppCheck Enterprise` are strictly forbidden as they require linking a Google Cloud Billing account and can incur non-zero costs once quotas or API thresholds are reached.
- **Client SDK Import**:
  ```typescript
  import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
  ```

### 1.2 Site Key Safety & Token Lifecycle
- **Site Key Public Nature**: The reCAPTCHA v3 Site Key (`VITE_RECAPTCHA_V3_SITE_KEY`) is a public client-side identifier, mathematically and architecturally equivalent to the Firebase `apiKey` or `projectId`. It is designed to be embedded in the client bundle. The secret key is stored exclusively on Google Cloud / Firebase console backend and is never exposed.
- **Token Time-to-Live (TTL)**:
  - Default TTL: **1 hour (3,600 seconds)**.
  - Configurable range in Firebase Console: 30 minutes to 7 days.
  - Recommended setting for LogBook: **1 hour**. This provides an optimal trade-off between security freshness and minimizing unnecessary re-attestation requests.
- **Proactive Token Refresh**:
  - `isTokenAutoRefreshEnabled: true` ensures that the Firebase App Check SDK automatically refreshes the attestation token in the background prior to expiration.
  - If a user leaves the PWA suspended in a background tab and returns hours later, the App Check SDK automatically acquires a fresh token upon network activity.

### 1.3 Two-Phase Rollout Plan (Monitor Mode $\rightarrow$ Enforcement Mode)
To avoid lockouts of legitimate users during rollout, App Check must follow a strict two-phase progression:

```
+-------------------------------------------------------------+
| Phase 1: Monitor Mode (Unenforced)                         |
| - Register Web App with reCAPTCHA v3 Site Key in Console    |
| - Keep Firestore App Check Enforcement = OFF (Monitoring)   |
| - Client initializes AppCheck (ReCaptchaV3Provider)         |
| - Monitor Firebase Console Metrics for 7-14 days           |
| - Verify >99% legitimate requests are 'Verified'            |
| - Test across iOS Safari, Android Chrome, Desktop PWA       |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Phase 2: Enforcement Mode (Active Shield)                  |
| - Toggle Cloud Firestore App Check to 'Enforced'            |
| - Unverified / bot / scripted requests rejected at edge    |
| - 0 extra cost for rejected requests                        |
+-------------------------------------------------------------+
```

1. **Phase 1 (Monitoring / Unenforced)**:
   - Configure App Check in Firebase Console with `ReCaptchaV3Provider`.
   - Set Firestore enforcement to **Unenforced**.
   - Monitor the Firebase App Check dashboard metrics:
     - *Verified requests* (legitimate user traffic passing reCAPTCHA v3 score)
     - *Unverified requests* (traffic failing or missing attestation)
     - *Outdated requests* (stale tokens)
   - Enable debug tokens for local developer testing:
     ```typescript
     if (import.meta.env.DEV) {
       // @ts-ignore
       self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
     }
     ```
   - Target benchmark: Ensure that genuine users across all supported browsers (iOS Safari, Android Chrome, Desktop Web) achieve >99% verified attestation.

2. **Phase 2 (Enforcement Mode)**:
   - In the Firebase Console (App Check section), enable **Enforcement** on Cloud Firestore.
   - Any request lacking a valid App Check JWT token is rejected directly at the Google API edge gateway with an HTTP 403 / `permission-denied` status, preventing unauthorized API scraping, bot tampering, or malicious quota exhaustion.

---

### 1.4 Graceful Degradation: `isSupported() == false` & Offline Resilience
App Check relies on browser APIs (IndexedDB, Web Crypto, modern iframe sandboxing). In strict private/incognito modes, older browsers, or restrictive WebViews, `initializeAppCheck` or reCAPTCHA v3 may fail to initialize or `isSupported()` may return `false`.

**Architectural Rule**:
During enforcement, **bypassing App Check is strictly prohibited**. If App Check cannot be validated, the application must **NOT** attempt unauthorized cloud writes. Instead, it must gracefully degrade to **Tier 2/3 Local Storage (IndexedDB + Synchronous LocalStorage)** and inform the user.

```
                  +-----------------------------------+
                  |   App Initialization (main.tsx)   |
                  +-----------------------------------+
                                    |
                    Is App Check supported & valid?
                                   / \
                                  /   \
                             YES /     \ NO / Error
                                /       \
                               v         v
             +--------------------+   +------------------------------------+
             | Cloud Sync Active  |   | Fallback to Local Offline Mode     |
             | - Full Firestore   |   | - Cloud Sync disabled              |
             |   read/write sync  |   | - 100% features available locally  |
             +--------------------+   | - Local IndexedDB + LocalStorage   |
                                      | - Show user dialog in Italian      |
                                      +------------------------------------+
```

#### User Experience & Notification Specification:
- Dialog Trigger: When an unverified environment is detected and the user attempts cloud synchronization or Google Login.
- Component: `useDialogStore.getState().showAlert(...)`
- Tone: Italian, Sentence case, non-alarmist, reassuring.
- Text:
  - **Titolo**: *"Verifica di sicurezza non supportata"*
  - **Messaggio**: *"Il browser o la modalità di navigazione attuale non supportano i controlli di sicurezza necessari per la sincronizzazione cloud. LogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo."*

---

### 1.5 Security Checklist: Firebase Auth Authorized Domains & API Key Referrers
To completely secure the frontend and prevent unauthorized third parties from hijacking the Firebase project:

| Layer | Configuration Location | Action / Rule | Rationale |
|---|---|---|---|
| **Firebase Auth** | Firebase Console $\rightarrow$ Authentication $\rightarrow$ Settings $\rightarrow$ Authorized Domains | Whitelist only:<br>1. Production domain (e.g. `logbook.vercel.app`)<br>2. Preview domains (e.g. `*.vercel.app`)<br>3. `localhost` | Prevents `auth/unauthorized-domain` errors while blocking OAuth phishing or token theft from unauthorized origins. |
| **Google Cloud API Key** | Google Cloud Console $\rightarrow$ APIs & Services $\rightarrow$ Credentials $\rightarrow$ Browser Key | 1. **Application restrictions**: HTTP referrers (web sites).<br>2. **Allowed referrers**: `https://logbook*.vercel.app/*`, `https://yourdomain.com/*`, `http://localhost:*`<br>3. **API restrictions**: Restrict key strictly to:<br>- *Identity Toolkit API*<br>- *Token Service API*<br>- *Cloud Firestore API*<br>- *Firebase App Check API* | Restricts the public API key so that malicious actors cannot use it to call other Google Cloud APIs or make requests from unauthorized domains. |
| **Firestore Security** | Firebase Console $\rightarrow$ App Check $\rightarrow$ Firestore | Enable Firestore enforcement after Phase 1 validation. | Blocks all direct REST / SDK calls that do not originate from the attested LogBook web client. |

---

## 2. Zero-Cost Firestore Security Rules Architecture

### 2.1 The "Zero `get()` / `exists()`" Constraint
- On the Firebase Spark Tier, the daily read limit is **50,000 document reads/day**.
- Each `get()` or `exists()` statement inside Firestore security rules performs an **extra billable document read** every time the rule is evaluated.
- If a write batch touches 3 documents and evaluates rules containing 2 `get()` lookups each, it incurs $3 \times 2 = 6$ extra reads per save operation.
- **Architectural Solution**: Firestore Security Rules for LogBook execute with **ZERO `get()` and ZERO `exists()` calls ($0$ extra read cost)**. All validations are executed exclusively against:
  1. `request.auth` (Authentication context, UID)
  2. `request.resource.data` (Incoming payload)
  3. `resource.data` (Existing target document payload)
  4. Document path wildcards (`{userId}`, `{monthId}`)

---

### 2.2 Document Size & Payload Defense (Two-Tier Guardrails)

#### Tier 1: Client-Side Pre-Validation (`src/lib/db.ts`)
Before any write batch is constructed, `checkDocSize(data, docName)` measures the serialized UTF-8 payload byte length:
```typescript
function checkDocSize(data: any, docName: string) {
    const jsonStr = JSON.stringify(data);
    const sizeBytes = new Blob([jsonStr]).size;
    if (sizeBytes > 950000) { // Safety threshold under 1MB Firestore limit
        throw new Error(`Il documento ${docName} supera il limite di dimensione di Firestore (1MB). Ridurre i dati inseriti.`);
    }
}
```

#### Tier 2: Server-Side Firestore Security Rules Enforcement
The Firestore rules enforce structural bounds directly:
1. **Top-Level Field Whitelisting (`users/{userId}`)**:
   ```javascript
   incomingData().keys().hasOnly([
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
   ```
2. **Array Length Caps**:
   - `library` (custom user exercises): $\le 500$ items
   - `routines` (workout blueprints): $\le 100$ items
   - `customFoods` (user custom foods): $\le 1000$ items
   - `trainingCycles`: $\le 50$ items
   - `supplements`: $\le 50$ items
   - `activePains`: $\le 50$ items
3. **Subcollection Bucketing Boundaries**:
   - `history_months/{monthId}`:
     - `monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$')`
     - Maximum sessions per month doc: `incomingData().keys().size() <= 120` (up to 4 workouts per day)
   - `nutrition_months/{monthId}`:
     - `monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$')`
     - Maximum daily records per month doc: `incomingData().keys().size() <= 31` (1 record per calendar day)
4. **Global Public Catalog Collection (`catalog/{docId}`)**:
   - `allow read: if true;` (or `if isAuthenticated()`)
   - `allow write: if false;` (Client writes strictly denied; read-only distribution, modified only via Firebase Admin console).

---

### 2.3 Proposed Production `firestore.rules`

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // --- Helper Functions (Zero get() / exists() = 0 read cost) ---
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

    // Default Deny All
    match /{document=**} {
      allow read, write: if false;
    }

    // Public / Shared Catalog (R3 Global Catalog)
    match /catalog/{docId} {
      allow read: if true;
      allow write: if false; // Only manageable via Firebase Admin Console
    }

    // User Root Document: users/{userId}
    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      
      allow create, update: if isOwner(userId)
        // 1. Strict field whitelist
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
        // 2. Type integrity checks
        && (incomingData().profile is map)
        && (!('activeWorkout' in incomingData()) || incomingData().activeWorkout == null || incomingData().activeWorkout is map)
        && (!('activeCycleId' in incomingData()) || incomingData().activeCycleId == null || incomingData().activeCycleId is string)
        && (!('nutritionPlanning' in incomingData()) || incomingData().nutritionPlanning == null || incomingData().nutritionPlanning is map)
        // 3. Array length bounding
        && (!('library' in incomingData()) || (incomingData().library is list && incomingData().library.size() <= 500))
        && (!('routines' in incomingData()) || (incomingData().routines is list && incomingData().routines.size() <= 100))
        && (!('customFoods' in incomingData()) || (incomingData().customFoods is list && incomingData().customFoods.size() <= 1000))
        && (!('trainingCycles' in incomingData()) || (incomingData().trainingCycles is list && incomingData().trainingCycles.size() <= 50))
        && (!('supplements' in incomingData()) || (incomingData().supplements is list && incomingData().supplements.size() <= 50))
        && (!('activePains' in incomingData()) || (incomingData().activePains is list && incomingData().activePains.size() <= 50))
        && (!('catalogOverrides' in incomingData()) || (incomingData().catalogOverrides is list && incomingData().catalogOverrides.size() <= 200))
        && (!('catalogHiddenIds' in incomingData()) || (incomingData().catalogHiddenIds is list && incomingData().catalogHiddenIds.size() <= 500));
        
      // Subcollection: History Months (users/{userId}/history_months/{YYYY-MM})
      match /history_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId)
          && incomingData().keys().size() <= 120; // Max 120 workout sessions in a single month
      }
      
      // Subcollection: Nutrition Months (users/{userId}/nutrition_months/{YYYY-MM})
      match /nutrition_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId)
          && incomingData().keys().size() <= 31; // Max 31 days in a single month
      }
    }
  }
}
```

---

## 3. Spark Tier Quota Mathematical Modeling & Capacity Planning

### 3.1 Firebase Spark Tier Free Quota Limits
| Resource | Spark Daily Free Quota | Monthly Aggregate Equiv. | Reset Window |
|---|---|---|---|
| **Document Reads** | **50,000 / day** | 1,500,000 / month | 00:00 UTC (Midnight Pacific) |
| **Document Writes** | **20,000 / day** | 600,000 / month | 00:00 UTC |
| **Document Deletes** | **20,000 / day** | 600,000 / month | 00:00 UTC |
| **Cloud Storage** | **1 GiB** (1,024 MB) | 1,024 MB total | Persistent |
| **Network Egress** | **10 GiB / month** | 333 MB / day avg | Rolling month |
| **Concurrent Realtime** | **100 connections** | N/A | Instantaneous (LogBook = 0 listeners) |

---

### 3.2 Detailed Read Modeling (Windowed Fetch + Cache-First)

In LogBook, data reads are structured around:
1. **Windowed Loading (`db.ts`)**: On login/sync, only 3 months ($M, M-1, M-2$) are fetched instead of the full historical subcollection.
2. **IndexedDB Local Cache**: Fast startup bootstrap from `logbook_cached_user_data`.
3. **Firestore Persistent Local Cache (`persistentLocalCache`)**: Firebase SDK handles local caching and avoids redundant network fetches.
4. **Catalog Manifest Pattern (R3)**: Read single manifest doc; only download catalog data if version changed.

#### Read Operations Breakdown per Event:
- **Cold Boot / Initial Cloud Sync**:
  - `users/{uid}` (Root doc): 1 read
  - `history_months/{YYYY-MM}` (3 months windowed): 3 reads
  - `nutrition_months/{YYYY-MM}` (3 months windowed): 3 reads
  - `catalog/manifest` (Catalog version check): 1 read
  - **Total per Cold Sync**: **8 reads**
- **Warm Session / Tab Resume (`visibilitychange`)**:
  - Served directly from local cache or verifies pending writes: 0-8 reads (avg ~2 reads with cache validation).
- **Guest Users**: 0 reads (100% local storage).

#### Daily Read Consumption Profiles:
- **Average User**:
  - 2 app opens per day $\times$ 8 reads = **16 reads / user / day**.
- **Power User**:
  - 6 app opens / syncs per day $\times$ 8 reads = **48 reads / user / day**.

---

### 3.3 Detailed Write Modeling (1000ms Debounce + Deep Diffing)

LogBook optimizes writes using three defensive layers:
1. **1000ms Global Debounce (`DEBOUNCE_DELAY_GLOBAL = 1000ms`)**: Coalesces rapid keystrokes into a single write.
2. **Synchronous LocalStorage (`'logbook_local_workout'`)**: Active workout sets are saved instantly to localStorage, avoiding live Firestore writes on every rep/set.
3. **`fast-deep-equal` Diffing in `DB.saveUserData`**: Only documents that have actually changed are committed in the `writeBatch`.

#### Write Operations Breakdown per Activity:
- **Workout Logging**:
  - During workout: 0 cloud writes (live state in localStorage).
  - Finishing workout: 1 write to `users/{uid}` (`activeWorkout: null`) + 1 write to `history_months/{current_month}` = **2 writes**.
- **Nutrition Logging**:
  - 1 write to `nutrition_months/{current_month}` per meal logging event (breakfast, lunch, snack, dinner) = **1 write / meal session**.
- **Settings / Routine / Profile Edits**:
  - 1 write to `users/{uid}` = **1 write**.

#### Daily Write Consumption Profiles:
- **Average User**:
  - 1 workout (2 writes) + 3 meal logging sessions (3 writes) + 1 profile/routine tweak (1 write) = **6 writes / user / day**.
- **Power User**:
  - 1 intense workout with 2 intermediate syncs (3 writes) + 5 meal sessions (5 writes) + 2 custom foods / planning adjustments (2 writes) = **10 writes / user / day**.
- **Guest User**: 0 writes / day.

---

### 3.4 Mathematical Capacity & User Scaling Limits

$$\text{Max DAU (Writes)} = \frac{\text{Daily Write Quota}}{\text{Writes per User per Day}}$$
$$\text{Max DAU (Reads)} = \frac{\text{Daily Read Quota}}{\text{Reads per User per Day}}$$

| User Persona | Writes/User/Day | Reads/User/Day | Max DAU on Writes Quota (20k/day) | Max DAU on Reads Quota (50k/day) |
|---|---|---|---|---|
| **100% Average Users** | 6 | 16 | **3,333 DAU** | **3,125 DAU** |
| **100% Power Users** | 10 | 48 | **2,000 DAU** | **1,041 DAU** |
| **Blended Real-World (80% Avg / 20% Power)** | **6.8** | **22.4** | **2,941 DAU** | **2,232 DAU** |

#### Limiting Factor Analysis:
- The **governing bottleneck** under heavy power-user read patterns is the **50,000 daily read limit**, supporting **~2,232 Daily Active Users** simultaneously in a mixed distribution.
- Under typical average usage, the system comfortably accommodates **~3,100 Daily Active Users** for free.

---

### 3.5 Storage Capacity & Document Lifecycle (1 GiB Quota)

#### Document Size Metrics:
- **Root Document (`users/{uid}`)** (with Global Catalog separated):
  - User profile, active cycles, custom foods (~30 items), routine templates (~5 items): **~15 KB**.
- **History Subcollection (`history_months/{YYYY-MM}`)**:
  - 15-20 workout sessions per month: **~15 KB / month** ($12 \times 15 = 180 \text{ KB / year}$).
- **Nutrition Subcollection (`nutrition_months/{YYYY-MM}`)**:
  - 30 daily logs with meals and supplement intakes: **~20 KB / month** ($12 \times 20 = 240 \text{ KB / year}$).
- **Total Storage per Active User for 1 Full Year**:
  $$\text{Storage}_{\text{user-year}} = 15 \text{ KB} + 180 \text{ KB} + 240 \text{ KB} \approx \mathbf{435 \text{ KB}} \ (0.425 \text{ MB})$$

#### Storage Capacity Calculation:
$$\text{Max Long-Term Users} = \frac{1,024 \text{ MB}}{0.425 \text{ MB/user}} \approx \mathbf{2,409 \text{ active annual users}}$$

---

### 3.6 Operational Monitoring Protocol & Safe Spark Thresholds
Because Cloud Billing alerts are disallowed under the zero-cost mandate, operational health is managed via **Manual Dashboard Inspections** and **Client-Side Safeguards**:

```
+------------------------------------------------------------------------------------+
| SPARK QUOTA OPERATIONAL THRESHOLDS                                                 |
+------------------------------------------------------------------------------------+
| 🟢 GREEN ZONE (< 50% Quota)                                                        |
|   - Daily Writes: < 10,000 | Daily Reads: < 25,000 | Storage: < 500 MB             |
|   - Action: Standard operation. Bi-weekly manual check on Firebase Console.        |
+------------------------------------------------------------------------------------+
| 🟡 YELLOW ZONE (50% - 80% Quota)                                                   |
|   - Daily Writes: 10,000 - 16,000 | Daily Reads: 25,000 - 40,000 | Storage: < 800MB|
|   - Action: Analyze DAU spikes. Adjust windowed read offset from 3 to 2 months.    |
+------------------------------------------------------------------------------------+
| 🔴 RED ZONE (> 80% Quota)                                                          |
|   - Daily Writes: > 16,000 | Daily Reads: > 40,000 | Storage: > 800 MB             |
|   - Action: Increase global client debounce to 2000ms. Set Guest mode as default.  |
+------------------------------------------------------------------------------------+
```

---

## 4. Synthesis & Recommendations for Implementation

1. **App Check Module**:
   - Implement `initAppCheck()` inside `src/lib/firebase.ts` wrapped in `try/catch` with `isSupported()` check.
   - Introduce `VITE_RECAPTCHA_V3_SITE_KEY` in `.env.production`.
   - On App Check failure, flag `isCloudSyncDisabled = true` and fallback seamlessly to offline IndexedDB/LocalStorage.
2. **Firestore Security Rules**:
   - Deploy the zero-cost rules containing zero `get()`/`exists()` calls.
   - Enforce key whitelisting and array bounding to permanently block database pollution attacks.
3. **Storage Pre-flight**:
   - Retain `checkDocSize(data, 950000)` in `db.ts` as client-side first line of defense.
4. **Quota Safety**:
   - With ~2,200 - 3,100 DAU capacity, LogBook operates safely within Spark tier limits.
