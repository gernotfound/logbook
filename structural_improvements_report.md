# Rapporto di Sintesi: Miglioramenti Strutturali e Architetturali UI/CSS

> **Progetto:** LogBook PWA (Fitness Tracking)  
> **Data:** 12 Settembre 2026  
> **Autore:** Teamwork Architecture Review Team (`worker_m2_1`)  
> **Stato:** Normativo e Azionabile — Proposta Architetturale  
> **File di Riferimento Normativo:** `AGENTS.md`, `docs/design-system.md`  
> **Commit Baseline (`main`):** `a4f8b1d1b593d15659822ff08a3f89f41c9f3a1f`  
> **Rami Analizzati:**  
> - `origin/restyling-gpt-1` (`09e1b9cbdf15ffa58235dbb3a7d683313fcf9dfe`)  
> - `origin/restyling-gpt-2` (`2eeb1269e5ce2d37ae0e7f4599ea695d5f1a7491`)  
> - `origin/restyling-gpt-3` (`7505d8fb93831c4913e7b2c2889e70d6eb0c27b4`)  

---

## 1. Executive Summary & Assessment Scope

### 1.1 Scopo e Obiettivi dell'Analisi
Il presente rapporto costituisce lo studio architetturale definitivo e la sintesi unificata delle migliorie strutturali e di ingegneria UI/CSS emerse dall'ispezione dei tre rami sperimentali di restyling (`origin/restyling-gpt-1`, `origin/restyling-gpt-2`, `origin/restyling-gpt-3`).

L'obiettivo fondamentale dell'indagine è **estrarre e isolare esclusivamente i miglioramenti strutturali, architetturali e di manutenibilità del codice React/CSS**, quali:
1. **Eliminazione sistematica degli stili inline** (`style={{ ... }}`) a favore di classi semantiche native e layout modulari.
2. **Introduzione di un'architettura di tokenizzazione CSS gerarchica** basata su unità scalabili (`rem`) con un layer di alias retrocompatibili per non rompere le schermate secondarie.
3. **Creazione di primitive UI riutilizzabili** (es. sub-navigation generica `<SectionTabs<T> />`, campi di misurazione `<MeasurementField />`, chip metrici `.metric-chip`, segmented control accessibili, empty state, hero pattern).
4. **Standardizzazione rigorosa dell'iconografia** tramite vettori accessibili `lucide-react`, eliminando caratteri ASCII e icone emoji di sistema che degradano la consistenza tra piattaforme (iOS, Android, Desktop).
5. **Rafforzamento dell'accessibilità e dell'esperienza mobile (a11y & touch hardening)**, garantendo touch target conformi (>= 44x44px), `inputMode` ottimizzati (`decimal`/`numeric`), attributi ARIA corretti e navigazione da tastiera.
6. **Hardening della suite di test e protezione degli invarianti**, con l'adozione di test di regressione dedicati per i controlli del timer di recupero e per l'app shell.

Al contempo, **ogni alterazione dell'identità visiva "Dark Glassmorphism" viene rigorosamente rigettata e scartata**. I tentativi di sostituire le superfici traslucide in vetro con finiture piatte e opache ("OLED athletic matte", "Midnight Performance"), i cambi arbitrari della palette colori (verso il viola Tailwind `#a855f7` o il cyan tenue `#22d3ee`), l'iniezione di font esterni con tracking esasperato e i badge di branding superflui sono catalogati come "design drift" incompatibili con i contratti di progetto.

### 1.2 Metodologia di Ispezione e Vincolo di Zero Modifiche
L'analisi è stata condotta adottando una procedura di ispezione statica rigorosamente in sola lettura sul repository `c:\Users\gerar\Documents\GitHub\logbook`:
- Nessun checkout, merge, rebase, cherry-pick o push è stato eseguito.
- Il working tree di `main` rimane perfettamente intatto e pulito.
- Ogni riscontro è corredato da percorsi file esatti, intervalli di riga e snippet di codice reali estratti sia da `main` che dai commit canonici dei tre rami remoti.

---

## 2. Matrice Comparativa tra i Rami e Panoramica Architetturale

### 2.1 Tabella Sinottica dei Rami Esplorati

| Metrica / Criterio | `origin/restyling-gpt-1` | `origin/restyling-gpt-2` | `origin/restyling-gpt-3` | Sintesi Proposta per `main` |
|---|---|---|---|---|
| **Commit Target** | `09e1b9c` | `2eeb126` (post hardening `15e7a18`) | `7505d8f` (post hardening `1c745de`) | Baseline `a4f8b1d` |
| **Commit Totali** | 2 commit (`275bfcc`, `09e1b9c`) | 3 commit (`da65bfc`, `15e7a18`, `2eeb126`) | 3 commit (`c11c2ea`, `1c745de`, `7505d8f`) | Adozione pianificata a fasi |
| **Volume File Coinvolti** | 36 file (+2815 / -2374 righe) | 23 file (+2862 / -1128 righe) | 22 file (+2048 / -727 righe) | Circa 20-25 file mirati |
| **Organizzazione CSS** | 10 file modulari di dominio (`tokens.css`, `workout.css`, `nutrition.css`, etc.) | 3 file (`tokens.css`, `design-system.css`, `workout.css`) | 3 file (`tokens.css`, `restyling.css`, `interaction-guardrails.css`) | Modulare a 3 livelli: `tokens.css` + `interaction-guardrails.css` + CSS di dominio |
| **Layer Alias Legacy** | Parziale (variabili flat) | Parziale | **Eccellente** (alias automatici `--bg-color`, `--primary-color`, etc.) | **Adottare layer alias di Branch 3** |
| **Componentizzazione React** | `MeasurementField.tsx`, `renderUnsyncedLogout`, `GoogleMark` | **`SectionTabs.tsx`**, `ChartFallback`, `ViewLoading` | Pattern hero, `ChartFallback` | **Adottare `SectionTabs.tsx` (B2) e `MeasurementField.tsx` (B1)** |
| **Pulizia Auth (`LoginBox.tsx`)** | Parziale | **Totale ed esaustiva** (18+ inline styles eliminati, BEM) | Non modificato | **Adottare implementazione Branch 2** |
| **Workout Session & Timer** | Eccellente (classi semantiche, `lucide-react`) | **Superiore** (aggiunge header colonne serie, preserva regressioni) | Ottimo (guardrail 44px) | **Fondere Branch 2 (colonne/inputMode) con Branch 3 (guardrail)** |
| **Touch Hardening (>= 44px)** | Standard (regole nei selettori) | Standard (variabile 48px/44px) | **Superiore** (`interaction-guardrails.css` programmatico) | **Adottare `interaction-guardrails.css`** |
| **Test di Regressione UI** | `tests/workout_timer_ui.test.tsx` | Nessun file nuovo (fix E2E esistenti) | `tests/restyling_timer_invariant.test.tsx`, `tests/header_visibility_rules.test.tsx` | **Adottare tutte le suite (B1 + B3)** |
| **Aderenza Dark Glassmorphism** | ❌ Viola (Matte surfaces, no blur, Tailwind purple) | ❌ Viola (Matte surfaces, no blur, Tailwind purple) | ❌ Viola (Midnight Performance, Cyan, no blur) | **Ripristinare 100% Dark Glassmorphism canonico** |

---

### 2.2 Analisi di Sintesi per Singolo Ramo

#### Ramo 1: `origin/restyling-gpt-1` ("OLED Athletic Restyling")
- **Punti di Forza:** È il ramo con la copertura di refactoring più estesa dell'intero prodotto (36 file). Interviene in modo pervasivo su aree periferiche che gli altri rami non hanno toccato: Nutrizione dettagliata (`NutritionMeals.tsx`), Misurazioni corporee (`DataMeasurements.tsx`), Impostazioni e Gestione Account (`SettingsView.tsx`, `AccountCard.tsx`), e Overlay globali (`GlobalDialog.tsx`, prompt PWA `ReloadPrompt.tsx`, `InstallPrompt.tsx`). Estrae l'utilissimo pattern `MeasurementField` che elimina oltre 15 blocchi di input duplicati.
- **Punti Deboli:** Introduce un'architettura CSS forse eccessivamente frammentata (10 file CSS distinti). Cede a un redesign estetico appiattito ("OLED flat matte") azzerando il `backdrop-filter` e alterando la palette cromatica canonica.

#### Ramo 2: `origin/restyling-gpt-2` ("High-Scale Design System & Regression Contracts")
- **Punti di Forza:** Rappresenta l'apice ingegneristico per quanto riguarda la componentizzazione e la preservazione dei contratti di regressione. Crea la gemma architetturale `SectionTabs.tsx`, una primitiva generica e accessibile che centralizza la navigazione secondaria in `TrainingView`, `NutritionView` e `DataView`. Esegue la migrazione più pulita ed elegante di `LoginBox.tsx`.
- **Valore Inestimabile dei Commit di Hardening:** I commit successivi `15e7a18` e `2eeb126` dimostrano sul campo la sensibilità della suite di test E2E Playwright: quando il restyling iniziale aveva modificato labels e min-width, i test E2E si erano rotti. L'autore ha saputo ripristinare i contratti esatti (`CARBO`, `PRO`, `GRASSI`, `+`, `✕`, `- Rimuovi serie`, `min-width: 0`). Questo lavoro previene regressioni invisibili.

#### Ramo 3: `origin/restyling-gpt-3` ("Midnight Performance & Interaction Guardrails")
- **Punti di Forza:** Fornisce la migliore architettura di tokenizzazione CSS (`tokens.css`) grazie all'integrazione di un layer di alias legacy che consente un'adozione non-distruttiva da parte delle viste secondarie. Introduce `interaction-guardrails.css`, garantendo a livello di browser che i touch target non scendano mai sotto 44x44px (anche su viewport stretti `<= 340px`). Modernizza l'App shell con l'uso dell'attributo semantico HTML `hidden` sui pannelli non attivi e introduce test di regressione solidissimi (`restyling_timer_invariant.test.tsx` e `header_visibility_rules.test.tsx`).
- **Punti Deboli:** Ha tentato un cambio di branding non autorizzato denominato "Midnight Performance", sostituendo il colore primario `#00e5ff` con `#22d3ee`, cancellando il colore di accento secondario `#cc00ff` e azzerando i riflessi e i blur traslucidi.

---

## 3. Inventario Dettagliato dei Miglioramenti Strutturali e Architetturali

Di seguito viene documentata in dettaglio ciascuna proposta di miglioramento strutturale, organizzata per area e componente.

---

### Area 1: Architettura di Tokenizzazione CSS e Layer di Compatibilità Legacy
* **File Coinvolti:** `src/styles/tokens.css`, `src/styles/interaction-guardrails.css`, `src/styles/global.css`

#### Stato Attuale su `main`
In `src/styles/global.css:1-35`, il progetto dichiara soltanto una dozzina di variabili piatte relative ai colori e a valori base del vetro:
```css
:root {
  --bg-color: #000000;
  --surface-color: #0d0d0d;
  --surface-light: #1a1a1a;
  --primary-color: #00e5ff;
  --primary-glow: rgba(0, 229, 255, 0.3);
  --accent-color: #cc00ff;
  --danger-color: #ff4d6d;
  --warning-color: #ffb703;
  --success-color: #2ecc71;
  --glass-bg: rgba(13, 13, 13, 0.85);
  --glass-border: rgba(255, 255, 255, 0.1);
  --text-main: #f0f0f0;
  --text-muted: #9ba3af;
  --border-radius: 12px;
  --spacing: 16px;
}
```
Non esistono scale semantiche di spaziatura, raggi di curvatura progressivi, livelli standard di z-index o token di transizione. I componenti React sono costretti a ricorrere a valori arbitrari in pixel cablati inline (es. `padding: '12px 16px'`, `gap: '10px'`, `borderRadius: '8px'`).

#### Stato Migliorato (Estratto da `origin/restyling-gpt-3` con Guardrail da `interaction-guardrails.css`)
Introduzione di una scala di tokenizzazione standardizzata e interoperabile:
```css
:root {
  color-scheme: dark;

  /* Spacing Scale (rem per accessibilità) */
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.25rem;  /* 20px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-10: 2.5rem;  /* 40px */

  /* Radius Scale */
  --radius-xs: 0.375rem; /* 6px */
  --radius-sm: 0.5rem;   /* 8px */
  --radius-md: 0.75rem;  /* 12px */
  --radius-lg: 1rem;     /* 16px */
  --radius-pill: 9999px;

  /* Elevation & Shadows */
  --shadow-surface: 0 12px 36px rgba(0, 0, 0, 0.34);
  --shadow-floating: 0 18px 48px rgba(0, 0, 0, 0.56);
  --shadow-glass: 0 8px 32px 0 rgba(0, 0, 0, 0.37);

  /* Motion & Easings */
  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --duration-slow: 260ms;
  --ease-standard: cubic-bezier(0.16, 1, 0.3, 1);

  /* Z-Index Hierarchy */
  --z-sticky: 100;
  --z-banner: 8888;
  --z-sync: 9990;
  --z-nav: 10000;
  --z-toast: 10002;
  --z-dialog: 10005;

  /* Touch Target Invariant Guardrail */
  --interactive-target-min: 2.75rem; /* Esattamente 44px */

  /* Legacy Aliases Layer: garantisce la retrocompatibilità totale */
  --bg-color: #000000;
  --surface-color: #0d0d0d;
  --surface-light: #1a1a1a;
  --primary-color: #00e5ff;
  --primary-glow: rgba(0, 229, 255, 0.3);
  --accent-color: #cc00ff;
  --danger-color: #ff4d6d;
  --warning-color: #ffb703;
  --success-color: #2ecc71;
  --glass-bg: rgba(13, 13, 13, 0.85);
  --glass-border: rgba(255, 255, 255, 0.1);
  --text-main: #f0f0f0;
  --text-muted: #9ba3af;
  --border-radius: var(--radius-md);
  --spacing: var(--space-4);
}
```

In `interaction-guardrails.css`:
```css
.segmented-control__item,
.guest-mode-banner__action,
.recovery-count {
  min-height: var(--interactive-target-min);
}

@media (max-width: 340px) {
  .timer-btn {
    width: var(--interactive-target-min);
    min-width: var(--interactive-target-min);
    height: var(--interactive-target-min);
    min-height: var(--interactive-target-min);
  }
}
```

#### Razionale Architetturale e React
- **Eliminazione dei Magic Numbers:** Sostituisce pixel sparsi con token semantici proporzionali.
- **Adozione Incrementale (Zero Big-Bang):** Il blocco dei legacy aliases fa sì che tutte le schermate non ancora refactoringate ereditino i nuovi token senza rompersi.
- **Garanzia Programmatica dei 44px:** L'inclusione di `interaction-guardrails.css` assicura che bottoni e controlli rispettino programmaticamente le linee guida di accessibilità per schermi touch.

#### Verifica di Conformità (`AGENTS.md` & `docs/design-system.md`)
- **No Tailwind:** 100% CSS nativo puro standard W3C.
- **Dark Glassmorphism:** I colori legacy e le trasparenze rimangono rigorosamente agganciati ai valori canonici (`#000000`, `#0d0d0d`, `#00e5ff`, `#cc00ff`, `rgba(13, 13, 13, 0.85)`).
- **Mobile Touch 44px:** Soddisfatto e blindato via `--interactive-target-min: 2.75rem`.

---

### Area 2: Primitiva di Navigazione Secondaria Riutilizzabile (`SectionTabs.tsx`)
* **File Coinvolti:** `src/components/UI/SectionTabs.tsx` (Nuovo), `src/components/Training/TrainingView.tsx`, `src/components/Nutrition/NutritionView.tsx`, `src/components/Data/DataView.tsx`

#### Stato Attuale su `main`
In tre viste distinte del progetto (`TrainingView.tsx:24-38`, `NutritionView.tsx:81-141`, `DataView.tsx:38-83`), si trova duplicato identicamente il seguente blocco di codice con gestione dello scroll orizzontale tramite mouse wheel e serie di 4-5 bottoni hardcoded:
```tsx
// Esempio in TrainingView.tsx:24-38
const handleWheel = (e: any) => {
    if (e.deltaY !== 0) {
        e.currentTarget.scrollLeft += e.deltaY;
    }
};
// ...
<div className="sub-nav" role="tablist" aria-label="Sotto-menu Allenamento" onWheel={handleWheel}>
    <button type="button" role="tab" aria-selected={subTab === 'session'} className={`sub-nav-btn ${subTab === 'session' ? 'active' : ''}`} onClick={() => setSubTab?.('session')}>Sessione</button>
    <button type="button" role="tab" aria-selected={subTab === 'planning'} className={`sub-nav-btn ${subTab === 'planning' ? 'active' : ''}`} onClick={() => setSubTab?.('planning')}>Pianificazione</button>
    <button type="button" role="tab" aria-selected={subTab === 'routines'} className={`sub-nav-btn ${subTab === 'routines' ? 'active' : ''}`} onClick={() => setSubTab?.('routines')}>Schede</button>
    <button type="button" role="tab" aria-selected={subTab === 'exercises'} className={`sub-nav-btn ${subTab === 'exercises' ? 'active' : ''}`} onClick={() => setSubTab?.('exercises')}>Esercizi</button>
    <button type="button" role="tab" aria-selected={subTab === 'history'} className={`sub-nav-btn ${subTab === 'history' ? 'active' : ''}`} onClick={() => setSubTab?.('history')}>Storico</button>
</div>
```
Questo pattern viola il principio DRY, espone tipizzazioni permissive (`e: any`) e disperde la logica di accessibilità.

#### Stato Migliorato (Estratto da `origin/restyling-gpt-2:src/components/UI/SectionTabs.tsx:1-62`)
Creazione di un componente React generico, type-safe e accessibile:
```tsx
import type { WheelEvent } from 'react';

export interface SectionTabOption<T extends string> {
  value: T;
  label: string;
  ariaLabel?: string;
}

interface SectionTabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: readonly SectionTabOption<T>[];
  ariaLabel: string;
  className?: string;
}

/**
 * Navigazione secondaria condivisa tra le aree dell'app.
 * Mantiene le classi legacy sub-nav/sub-nav-btn perché sono usate dagli E2E,
 * aggiungendo classi semantiche per il design system.
 */
export function SectionTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
  className = '',
}: SectionTabsProps<T>) {
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY !== 0) {
      event.currentTarget.scrollLeft += event.deltaY;
    }
  };

  return (
    <div
      className={`sub-nav section-tabs ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
      onWheel={handleWheel}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={tab.ariaLabel}
            className={`sub-nav-btn section-tab ${isActive ? 'active' : ''}`}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default SectionTabs;
```

Utilizzo nei consumer (es. in `TrainingView.tsx`):
```tsx
const TRAINING_TABS = [
  { value: 'session', label: 'Sessione' },
  { value: 'planning', label: 'Pianificazione' },
  { value: 'routines', label: 'Schede' },
  { value: 'exercises', label: 'Esercizi' },
  { value: 'history', label: 'Storico' },
] as const;

<SectionTabs
  value={subTab}
  onChange={setSubTab}
  tabs={TRAINING_TABS}
  ariaLabel="Sotto-menu Allenamento"
/>
```

#### Razionale Architetturale e React
- **DRY e Manutenibilità:** Elimina oltre 120 righe di JSX duplicato in tre viste diverse.
- **Type Safety con Generics:** `T extends string` impedisce il passaggio di stringhe arbitrarie, garantendo la corrispondenza esatta con i tipi di tab ammessi dal rispettivo store.
- **Preservazione dei Contratti E2E:** Mantiene intenzionalmente le classi `.sub-nav` e `.sub-nav-btn`, evitando rotture nei test Playwright.

#### Verifica di Conformità (`AGENTS.md` & `docs/design-system.md`)
- **Nessun `<dialog>`:** È un componente di navigazione puro.
- **Touch Target:** I bottoni ereditano `.sub-nav-btn` con altezza minima 44px.
- **Italian Sentence Case:** Rispettato in tutte le opzioni ("Sessione", "Pianificazione", "Schede", "Esercizi", "Storico").

---

### Area 3: Eliminazione Sistematica degli Stili Inline nell'Autenticazione (`LoginBox.tsx`)
* **File Coinvolti:** `src/components/UI/LoginBox.tsx`, `src/styles/global.css` (o CSS di modulo)

#### Stato Attuale su `main`
In `src/components/UI/LoginBox.tsx:75-195`, l'intero form di accesso è costruito con stili inline:
```tsx
// main: righe 75-85
<div id="auth-login-box" style={{ textAlign: 'center', width: '90%', maxWidth: '400px', margin: '0 auto', padding: '30px', background: 'rgba(30, 41, 59, 0.7)', backdropFilter: 'blur(10px)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
    <h1 style={{ color: 'var(--primary-color)', marginBottom: '10px' }}>LogBook</h1>
    <p style={{ marginBottom: '20px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        Accedi o registrati per sincronizzare i tuoi allenamenti sul cloud.
    </p>

    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button 
            type="button"
            className={`btn ${mode === 'login' || mode === 'forgot' ? 'btn-primary' : ''}`} 
            style={{ flex: 1, margin: 0, padding: '10px', background: (mode === 'login' || mode === 'forgot') ? '' : 'rgba(255,255,255,0.05)', color: (mode === 'login' || mode === 'forgot') ? '' : 'var(--text-muted)', border: (mode === 'login' || mode === 'forgot') ? '' : '1px solid var(--glass-border)' }}
            onClick={() => { setMode('login'); setPassword(''); setConfirmPassword(''); }}
        >
            Accedi
        </button>
// ... e così via per 18 proprietà inline (password toggle, separatore, pulsanti Google e Guest)
```
Questo approccio ricrea decine di oggetti stile JavaScript ad ogni render, viola `AGENTS.md` ("MUST: Non usare stili inline"), include violazioni del Sentence case ("Conferma Password", "Invia Link di Recupero") e rende impossibile applicare media query per schermi stretti.

#### Stato Migliorato (Estratto da `origin/restyling-gpt-2:src/components/UI/LoginBox.tsx:81-190`)
Eliminazione completa di tutti gli stili inline a favore di classi CSS semantiche strutturate:
```tsx
<div id="auth-login-box" className="auth-card">
    <div className="auth-brand">
        <h1>LogBook</h1>
        <p>Allenamenti, nutrizione e progressi. I tuoi dati restano disponibili anche offline.</p>
    </div>

    <div className="auth-mode-switch" role="tablist" aria-label="Modalità accesso">
        <button
            type="button"
            role="tab"
            aria-selected={mode === 'login' || mode === 'forgot'}
            className={`btn ${mode === 'login' || mode === 'forgot' ? 'active' : ''}`}
            onClick={() => switchMode('login')}
        >
            Accedi
        </button>
        <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`btn ${mode === 'register' ? 'active' : ''}`}
            onClick={() => switchMode('register')}
        >
            Registrati
        </button>
    </div>

    <form onSubmit={handleSubmit} className="auth-form">
        <input
            type="email"
            placeholder="La tua email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
            autoComplete="email"
        />

        {mode !== 'forgot' && (
            <div className="auth-password-field">
                <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={mode === 'register' ? 'Password (min 8 caratteri)' : 'Password'}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    required
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
                <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
            </div>
        )}

        {mode === 'register' && (
            <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Conferma password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                required
                autoComplete="new-password"
            />
        )}

        <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || (mode === 'forgot' && resetSent)}
        >
            {loading ? 'Attendi...' : (mode === 'login' ? 'Accedi' : mode === 'register' ? 'Registrati' : 'Invia link di recupero')}
        </button>

        {mode === 'login' && (
            <button type="button" className="auth-link" onClick={() => setMode('forgot')}>
                Hai dimenticato la password?
            </button>
        )}
        {mode === 'forgot' && (
            <button type="button" className="auth-link auth-link--muted" onClick={() => setMode('login')}>
                Torna all'accesso
            </button>
        )}

        <div className="auth-separator"><span>oppure</span></div>

        <button id="btn-login-google" type="button" className="btn auth-google" onClick={login}>
            <GoogleMark />
            Accedi con Google
        </button>

        <button
            id="btn-login-anonymous"
            type="button"
            className="btn auth-guest"
            onClick={loginAsGuest}
        >
            Continua senza account
        </button>
        <p className="auth-footnote">I dati saranno salvati solo sul dispositivo.</p>
    </form>
</div>
```

#### Regole CSS Corrispondenti (Preservando il Dark Glassmorphism):
```css
.auth-card {
  width: 90%;
  max-width: 400px;
  margin: 0 auto;
  padding: var(--space-6);
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-floating);
  text-align: center;
}

.auth-mode-switch {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.auth-password-field {
  position: relative;
  width: 100%;
}

.auth-password-toggle {
  position: absolute;
  right: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 4px;
}
```

#### Razionale Architetturale e React
- **Conformità e Performance:** Pulisce oltre 100 righe di CSS inline riducendo l'overhead del Garbage Collector per gli oggetti style.
- **Correzione di Sentence Case Italiano:** Corregge esplicitamente "Conferma Password" in "Conferma password" e "Invia Link di Recupero" in "Invia link di recupero".
- **Preservazione degli ID per Test E2E:** Mantiene intatti gli ID storici `#auth-login-box`, `#btn-login-google`, `#btn-login-anonymous`.

#### Verifica di Conformità (`AGENTS.md` & `docs/design-system.md`)
- **No Tailwind:** Utilizzo esclusivo di classi CSS semantiche.
- **Dark Glassmorphism:** Preserva `backdrop-filter: blur(16px)`, `var(--glass-bg)` e `var(--glass-border)`.
- **iOS Safari 16px Rule:** Gli input ereditano il font-size 16px per prevenire l'auto-zoom di iOS.

---

### Area 4: Eliminazione degli Stili Inline nel Workout Session e nel Timer di Recupero
* **File Coinvolti:** `src/components/Training/WorkoutTimer.tsx`, `src/components/Training/SessionHeader.tsx`, `src/components/Training/ActiveWorkoutSession.tsx`

#### Stato Attuale su `main`
- In `WorkoutTimer.tsx:130-144`:
  ```tsx
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '0 10px' }}>
      <span className="timer-display" style={{ fontSize: '1.6rem', fontFamily: 'monospace', fontWeight: 'bold', color: restState === 'running' ? 'var(--warning-color)' : '#fff', letterSpacing: '2px' }}>
          {restDisplay}
      </span>
      <div className="timer-controls" style={{ display: 'flex', gap: '8px' }}>
          {restState !== 'running' ? (
              <button type="button" className="timer-btn play" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={startRest} aria-label="Avvia recupero" title="Avvia recupero">▶</button>
          ) : (
              <button type="button" className="timer-btn pause" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={pauseRest} aria-label="Pausa recupero" title="Pausa recupero">⏸</button>
          )}
          <button type="button" className="timer-btn reset" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={resetRest} aria-label="Riavvia recupero" title="Riavvia recupero">🔄</button>
          <button type="button" className="timer-btn stop" style={{ fontSize: '1.2rem', padding: '10px 14px' }} onClick={stopRest} aria-label="Ferma recupero" title="Ferma recupero">⏹</button>
      </div>
  </div>
  ```
- In `SessionHeader.tsx:24-54`: Stili inline per sticky header (`style={{ position: 'sticky', top: 'env(safe-area-inset-top, 0px)', ... }}`) e banner di modifica storico con emoji grezzo `✏️`.
- In `ActiveWorkoutSession.tsx:290-340`: Pulsanti di salvataggio/terminazione con blocchi inline di 15 righe ciascuno e icone emoji `💾`, `🏁`, `🗑️`.

#### Stato Migliorato (Estratto dai Rami di Restyling)
1. In `WorkoutTimer.tsx`:
   ```tsx
   <div className="workout-timer-shell" role="timer" aria-label={`Timer recupero ${restDisplay}`}>
       <span className={`timer-display ${restState === 'running' ? 'is-running' : ''}`} aria-live="off">
           {restDisplay}
       </span>
       <div className="timer-controls" aria-label="Controlli timer recupero">
           {restState !== 'running' ? (
               <button type="button" className="timer-btn play" onClick={startRest} aria-label="Avvia recupero" title="Avvia recupero">
                   <Play size={20} aria-hidden="true" />
               </button>
           ) : (
               <button type="button" className="timer-btn pause" onClick={pauseRest} aria-label="Pausa recupero" title="Pausa recupero">
                   <Pause size={20} aria-hidden="true" />
               </button>
           )}
           <button type="button" className="timer-btn reset" onClick={resetRest} aria-label="Riavvia recupero" title="Riavvia recupero">
               <RotateCcw size={20} aria-hidden="true" />
           </button>
           <button type="button" className="timer-btn stop" onClick={stopRest} aria-label="Ferma recupero" title="Ferma recupero">
               <Square size={19} aria-hidden="true" />
           </button>
       </div>
   </div>
   ```

2. In `SessionHeader.tsx`:
   ```tsx
   <div className="session-timer-bar">
       <WorkoutTimer />
   </div>

   {isEditingHistory && (
       <div className="session-history-banner">
           <div className="session-history-banner__content">
               <div className="session-history-banner__title">
                   <Pencil size={15} aria-hidden="true" />
                   <span>Modifica allenamento dello storico</span>
               </div>
               <div className="session-history-banner__meta">
                   {routineName || 'Sessione'} • {date || ''}
               </div>
           </div>
           <button 
               type="button"
               className="btn btn-small session-history-banner__action" 
               onClick={onCancelHistory}
           >
               Annulla
           </button>
       </div>
   )}
   ```

3. In `ActiveWorkoutSession.tsx`:
   ```tsx
   <div className="session-duration-card">
       <label htmlFor="workout-manual-duration" className="session-duration-card__label">
           <Clock3 size={16} aria-hidden="true" /> Durata della sessione
       </label>
       <input 
           id="workout-manual-duration"
           type="text" 
           value={manualDuration} 
           onChange={e => setManualDuration(e.target.value)} 
           onBlur={() => setManualDuration(Logic.normalizeDuration(manualDuration))}
           onFocus={e => e.target.select()}
           placeholder="00:00:00"
           className="session-duration-input"
       />
   </div>

   <div className="session-actions">
       {activeWorkout.isEditingHistory ? (
           <>
               <button type="button" className="btn btn-primary session-actions__primary" onClick={handleSaveHistory}>
                   <Save size={19} aria-hidden="true" /> Salva modifiche
               </button>
               <button type="button" className="btn btn-danger session-actions__secondary" onClick={handleCancelHistory}>
                   Annulla modifica
               </button>
           </>
       ) : (
           <>
               <button type="button" className="btn btn-success session-actions__primary" onClick={handleEndWorkout}>
                   <Flag size={19} aria-hidden="true" /> Termina sessione
               </button>
               <button type="button" className="btn btn-danger session-actions__secondary" onClick={deleteWorkout}>
                   <Trash2 size={18} aria-hidden="true" /> Elimina sessione
               </button>
           </>
       )}
   </div>
   ```

#### Razionale Architetturale e React
- **Preservazione Rigorosa degli Invarianti del Timer:** I 3 slot di controllo (Play/Pausa, Reset, Stop) rimangono fissi e immutati. Il ricalcolo delta su `Date.now()` e la persistenza locale in `localStorage` non vengono minimamente alterati.
- **Iconografia Uniforme:** Gli emoji `▶`, `⏸`, `🔄`, `⏹` vengono rimpiazzati da vettori `lucide-react` con dimensioni coerenti (`size={20}`).
- **Accessibilità Schermo:** L'uso di `aria-live="off"` sul display del timer impedisce ai lettori di schermo di annunciare fastidiosamente ogni singolo secondo che scorre durante il recupero.

#### Verifica di Conformità (`AGENTS.md` & `docs/design-system.md`)
- **Sticky Invariant:** La classe `.session-timer-bar` mantiene `position: sticky; top: env(safe-area-inset-top, 0px); z-index: 100;`.
- **Touch Target:** I controlli del timer hanno dimensione 48px, scalata a 44px su telefoni con larghezza <= 340px via `interaction-guardrails.css`.

---

### Area 5: Schede Esercizio e Righe Serie ad Alta Frequenza (`SessionExerciseCard.tsx`, `SessionSetRow.tsx`)
* **File Coinvolti:** `src/components/Training/session/SessionExerciseCard.tsx`, `src/components/Training/session/SessionSetRow.tsx`

#### Stato Attuale su `main`
- In `SessionSetRow.tsx:90-112`, il pulsante rotondo `+` per il menu dropset/isometria ha 17 proprietà CSS inline:
  ```tsx
  <button 
      className="btn-icon" 
      style={{ 
          background: 'var(--primary-color)', 
          borderRadius: '50%', 
          width: '36px', 
          height: '36px', 
          color: '#fff', 
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          margin: 0,
          fontSize: '1.2rem',
          lineHeight: 1,
          alignSelf: 'center'
      }} 
      onClick={onToggleMenu}
      aria-label="Aggiungi dropset o isometria"
  >
      +
  </button>
  ```
- In `SessionExerciseCard.tsx:142-230`, compaiono classi di utilità arbitrarie frammentate (`className="w-full bg-black-20 border-glass text-white p-8 rounded-8"`), menu di riposizionamento inline e assenza di intestazioni di colonna per le serie.

#### Stato Migliorato (Estratto da `origin/restyling-gpt-2` con Hardening `2eeb126`)
1. **Intestazioni Semantiche delle Colonne di Serie (`SessionExerciseCard.tsx`):**
   ```tsx
   <div className="workout-set-columns" aria-hidden="true">
       <span>Serie</span>
       <span>Kg</span>
       <span>{trackingType === 'time' ? 'Tempo' : 'Reps'}</span>
       <span>Extra</span>
   </div>
   ```
2. **Ottimizzazione Tastiera Mobile e Pulizia Righe Serie (`SessionSetRow.tsx`):**
   ```tsx
   <div className="workout-set-row set-row">
       <span className="workout-set-index">{index + 1}</span>
       <BufferedInput
           id={`kg-${s.id}`}
           type="number"
           inputMode="decimal"
           step="0.25"
           placeholder="Kg"
           value={s.kg ?? ''}
           onChange={val => onUpdateSet(s.id, 'kg', val)}
           onFocus={e => e.target.select()}
           className="workout-set-input"
           style={{ minWidth: 0, flex: 1 }}
       />
       <BufferedInput
           id={`reps-${s.id}`}
           type="number"
           inputMode="numeric"
           placeholder="Reps"
           value={s.reps ?? ''}
           onChange={val => onUpdateSet(s.id, 'reps', val)}
           onFocus={e => e.target.select()}
           className="workout-set-input"
           style={{ minWidth: 0, flex: 1 }}
       />
       <button
           type="button"
           className="workout-set-special-trigger"
           onClick={onToggleMenu}
           aria-label="Aggiungi dropset o isometria"
       >
           +
       </button>
   </div>
   ```

#### Razionale Architetturale e React
- **Preservazione dei Custom `React.memo` Comparators:** Entrambi i componenti esportano una funzione custom `areEqual` per comparare le props ed evitare costosi re-render ad ogni battuta di tasto. Questo contratto fondamentale **deve essere preservato al 100%**.
- **`inputMode` per Mobile UX:** L'aggiunta di `inputMode="decimal"` (per kg, distanza e velocità) e `inputMode="numeric"` (per ripetizioni e tempo) fa apparire la tastiera numerica nativa sia su iOS che su Android, eliminando la necessità di passare continuamente da lettere a numeri.
- **Rispetto dei Contratti E2E (`2eeb126`):** Vengono mantenuti il testo `+` del trigger, la classe `.set-row`, la proprietà `{ minWidth: 0, flex: 1 }` per evitare l'overflow flex e il pulsante di rimozione con testo o aria-label compatibile.

#### Verifica di Conformità (`AGENTS.md` & `docs/design-system.md`)
- **iOS Safari 16px Font-Size:** I campi input mantengono 16px senza innescare lo zoom dello schermo.
- **No Tailwind:** Struttura governata da `.workout-set-row` e `.workout-set-input`.

---

### Area 6: Primitive UI Riutilizzabili per Home Dashboard, Nutrizione e Dati
* **File Coinvolti:** `src/components/Data/DataMeasurements.tsx`, `src/components/Home/HomeView.tsx`, `src/components/Home/widgets/HeaderDashboard.tsx`, `src/components/Home/widgets/BiometryBentoCard.tsx`, `src/components/Home/widgets/HomeNutritionWidget.tsx`, `src/components/Home/widgets/HomeWorkoutWidget.tsx`, `src/components/Nutrition/NutritionMeals.tsx`

#### Catalogo delle Primitive Estratte dai Rami:

1. **`MeasurementField` (`origin/restyling-gpt-1:src/components/Data/DataMeasurements.tsx:39-58`):**
   ```tsx
   interface MeasurementFieldProps {
       id: string;
       label: string;
       value: string;
       onChange: (value: string) => void;
       placeholder?: string;
   }

   const MeasurementField = ({ id, label, value, onChange, placeholder }: MeasurementFieldProps) => (
       <label className="field-stack measurement-field">
           <span className="field-label">{label}</span>
           <input
               id={id}
               type="number"
               inputMode="decimal"
               step="0.1"
               placeholder={placeholder}
               value={value}
               onChange={event => onChange(event.target.value)}
               onFocus={event => event.target.select()}
           />
       </label>
   );
   ```
   *Impatto:* Sostituisce 15 blocchi di `<div className="input-row" style={{ ... }}>` identici, garantendo auto-selezione su focus e `inputMode="decimal"`.

2. **`.metric-chip` per i KPI (`HeaderDashboard.tsx`):**
   ```tsx
   <div className="metric-chip" aria-label={`${totalWorkouts} sessioni totali`}>
       <Dumbbell size={16} aria-hidden="true" />
       <span className="metric-chip__value">{totalWorkouts}</span>
       <span className="metric-chip__label">Sessioni</span>
   </div>
   ```

3. **`.segmented-control` e `.segmented-control__item` (`HomeView.tsx`):**
   ```tsx
   <div className="segmented-control" role="group" aria-label="Intervallo trend peso">
       {PERIOD_OPTIONS.map(period => (
           <button
               key={period.id}
               type="button"
               className={`segmented-control__item ${weightPeriod === period.id ? 'is-active' : ''}`}
               aria-pressed={weightPeriod === period.id}
               onClick={() => setWeightPeriod(period.id)}
           >
               {period.label}
           </button>
       ))}
   </div>
   ```

4. **`.workout-hero` Pattern a Stati (`HomeWorkoutWidget.tsx`):**
   Sostituisce i gradienti inline e differenzia semanticamente lo stato di riposo (`.workout-hero--ready`) da quello completato (`.workout-hero--complete`).

5. **`ChartFallback` & `.empty-state` con Icona Semantica (`HomeView.tsx`):**
   Sostituisce l'emoji `⚖️` con `<Scale size={24} aria-hidden="true" />` e centralizza lo scheletro visivo durante il caricamento dinamico dei grafici Chart.js.

6. **Accessibilità da Tastiera per Card Cliccabili (`HomeNutritionWidget.tsx`):**
   Aggiunge `role="button"`, `tabIndex={0}` e gestore eventi per tasti `Enter` e `Space` sulle card interattive che aprono sezioni.

---

### Area 7: Standardizzazione dell'Iconografia (`lucide-react`)
* **File Coinvolti:** Trasversale a tutto il repository

#### Censimento delle Sostituzioni da Eseguire:

| Contesto Componente | Carattere Raw / Emoji Attuale su `main` | Icona Vettoriale `lucide-react` Sostitutiva |
|---|---|---|
| **WorkoutTimer** | `▶` (Play) | `<Play size={20} aria-hidden="true" />` |
| **WorkoutTimer** | `⏸` (Pausa) | `<Pause size={20} aria-hidden="true" />` |
| **WorkoutTimer** | `🔄` (Reset) | `<RotateCcw size={20} aria-hidden="true" />` |
| **WorkoutTimer** | `⏹` (Stop) | `<Square size={19} aria-hidden="true" />` |
| **SessionHeader** | `✏️ Modifica allenamento` | `<Pencil size={15} aria-hidden="true" />` |
| **ActiveWorkoutSession** | `⏱️ Durata sessione` | `<Clock3 size={16} aria-hidden="true" />` |
| **ActiveWorkoutSession** | `💾 Salva modifiche` | `<Save size={19} aria-hidden="true" />` |
| **ActiveWorkoutSession** | `🏁 Termina sessione` | `<Flag size={19} aria-hidden="true" />` |
| **ActiveWorkoutSession** | `🗑️ Elimina sessione` | `<Trash2 size={18} aria-hidden="true" />` |
| **SessionExerciseCard** | `🗑️`, `🕒 Storico`, `⚙️ Setup` | `<Trash2 size={16} />`, `<History size={16} />`, `<Settings2 size={16} />` |
| **SessionSetRow** | `↳ Dropset`, `✕` | `<CornerDownRight size={14} />`, `<X size={14} />` |
| **RecoveryBentoCard** | `✕` | `<X size={14} aria-hidden="true" />` |
| **Home Dashboard** | `🔥` (Streak), `⚖️` (Peso vuoto) | `<Flame size={16} />`, `<Scale size={24} />` |
| **Guest Banner / Toast** | `⚠️` (Attenzione), `✕` (Chiudi) | `<TriangleAlert size={18} />`, `<X size={18} />` |
| **Impostazioni / Backup**| `📥`, `📤`, `📊`, `🔐`, `🤝` | `<Upload size={18} />`, `<Download size={18} />`, `<DatabaseBackup size={18} />`, `<Shield size={18} />`, `<KeyRound size={18} />` |

*Vantaggio Architetturale:* Elimina l'incoerenza estetica dei font emoji proprietari di Apple, Google e Microsoft. Consente il perfetto controllo di stroke, colore (`currentColor`) e dimensioni scalabili.

---

### Area 8: Modernizzazione dell'App Shell e Pannelli Accessibili (`App.tsx`, `BottomNav.tsx`)
* **File Coinvolti:** `src/App.tsx`, `src/components/UI/BottomNav.tsx`

#### Stato Attuale su `main`
- In `src/App.tsx:287-301`, le tab vengono mostrate/nascoste manipolando `style={{ display: activeTab === 'home' ? 'block' : 'none' }}`.
- In `src/components/UI/BottomNav.tsx:13-88`, 5 blocchi di bottoni identici sono copiati manualmente in JSX, con posizionamento fisso e dot di notifica conflitto scritti con stili inline. Manca l'attributo accessibile `aria-current="page"`.

#### Stato Migliorato (Estratto da `origin/restyling-gpt-3`)
1. **Pannelli Tab Semantici con Attributo HTML Nativo `hidden` (`App.tsx`):**
   ```tsx
   <div className="app-tab-panel" hidden={activeTab !== 'home'}>
       {(visitedTabs.home || activeTab === 'home') && <HomeView onNavigate={handleTabChange} />}
   </div>
   <div className="app-tab-panel" hidden={activeTab !== 'training'}>
       {(visitedTabs.training || activeTab === 'training') && <TrainingView />}
   </div>
   ```
   Regola CSS associata:
   ```css
   .app-tab-panel[hidden] {
       display: none !important;
   }
   ```
   *Beneficio:* L'attributo `hidden` è nativo, pienamente supportato dagli screen reader ed elimina la manipolazione inline di `style.display`.

2. **`BottomNav.tsx` Dichiarativo e Accessibile:**
   ```tsx
   const NAV_ITEMS = [
       { id: 'home', label: 'Home', icon: Home },
       { id: 'training', label: 'Allenamento', icon: Dumbbell },
       { id: 'nutrition', label: 'Nutrizione', icon: Utensils },
       { id: 'data', label: 'Dati', icon: Activity, ariaLabel: 'Dati e statistiche' },
       { id: 'settings', label: 'Impostazioni', icon: Settings },
   ] as const;

   export const BottomNav: React.FC = React.memo(() => {
       const activeTab = useAppStore(state => state.activeTab);
       const setActiveTab = useAppStore(state => state.setActiveTab);
       const hasNutritionConflict = useAppStore(state => !!state.userData?.pendingConflicts?.nutritionPlanning);

       return (
           <nav className="bottom-nav safe-bottom" aria-label="Navigazione principale">
               <div className="nav-container" aria-label="Sezioni dell'applicazione">
                   {NAV_ITEMS.map(item => {
                       const Icon = item.icon;
                       const isActive = activeTab === item.id;
                       const showConflict = item.id === 'nutrition' && hasNutritionConflict;

                       return (
                           <button
                               key={item.id}
                               type="button"
                               aria-label={'ariaLabel' in item ? item.ariaLabel : item.label}
                               aria-current={isActive ? 'page' : undefined}
                               className={`nav-item ${isActive ? 'active' : ''}`}
                               onClick={() => setActiveTab(item.id)}
                           >
                               <Icon size={22} aria-hidden="true" />
                               {showConflict && (
                                   <span
                                       className="nav-conflict-dot"
                                       title="Conflitto nutrizionale pendente"
                                       aria-hidden="true"
                                   />
                               )}
                               <span>{item.label}</span>
                           </button>
                       );
                   })}
               </div>
           </nav>
       );
   });
   ```
   *Beneficio:* Riduce 92 righe a 54, aggiunge `aria-current="page"`, preserva la stabilità dei selettori Zustand e rispetta il memoing.

---

### Area 9: Hardening della Suite di Test e Protezione degli Invarianti
* **File Coinvolti:** `tests/workout_timer_ui.test.tsx`, `tests/restyling_timer_invariant.test.tsx`, `tests/header_visibility_rules.test.tsx`, `e2e/offline.spec.ts`

#### Nuovi Test da Adottare:
1. **`tests/restyling_timer_invariant.test.tsx` (da Branch 3):**
   Verifica che in qualsiasi stato di riposo (Start, Pause, Reset, Stop) siano visibili **esattamente 3 controlli**, garantendo che nessun restyling possa mai nascondere i pulsanti critici.
2. **`tests/header_visibility_rules.test.tsx` (da Branch 3):**
   Verifica che durante la fase di caricamento iniziale (`#auth-loading`), la barra di navigazione principale non venga renderizzata a vuoto.
3. **Hardening Selettori E2E (`e2e/offline.spec.ts`):**
   Sostituisce selettori generici basati sul testo con query semantiche ARIA scoped:
   ```typescript
   const primaryNav = page.getByRole('navigation', { name: 'Navigazione principale' });
   await primaryNav.getByRole('button', { name: 'Allenamento', exact: true }).click();
   const activePanel = page.locator('.app-tab-panel:not([hidden])');
   await activePanel.getByRole('button', { name: 'Inizia allenamento', exact: true }).click();
   ```

---

## 4. Modifiche di Design Visivo da SCARTARE Rigorosamente

L'esame dei tre rami ha evidenziato diverse deviazioni estetiche che **violano frontalmente le prescrizioni di `AGENTS.md` e `docs/design-system.md`**. Tali modifiche devono essere respinte categoricamente:

```
                  ┌────────────────────────────────────────────────────────┐
                  │          FILTRO DI SINTESI ARCHITETTURALE              │
                  └────────────────────────────────────────────────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
┌─────────────────────────────────┐   ┌───────────────────────────────────┐
│   MIGLIORAMENTI STRUTTURALI     │   │      DEVIAZIONI ESTETICHE         │
│         DA ADOTTARE             │   │          DA SCARTARE              │
├─────────────────────────────────┤   ├───────────────────────────────────┤
│ • Token CSS a 3 livelli         │   │ • Superfici opache matte          │
│ • Sub-nav generica SectionTabs  │   │ • Eliminazione backdrop-filter    │
│ • Rimozione inline styles       │   │ • Palette Tailwind purple/cyan    │
│ • Primitive UI riutilizzabili   │   │ • Font esterni con tracking -0.025│
│ • Icone vettoriali Lucide       │   │ • Raggi di curvatura a 22-24px    │
│ • Guardrail touch 44x44px       │   │ • Eyebrow "Training companion"    │
│ • InputMode decimal/numeric     │   │ • Nome tema "Midnight Performance"│
└─────────────────────────────────┘   └───────────────────────────────────┘
```

### Dettaglio dei Reperti Visivi da Rigettare:

1. **Appiattimento a Superfici Opache e Rimozione del Blur (`backdrop-filter: none;`):**
   * *Riscontro:* In `restyling-gpt-1` (`modern.css:52`), `restyling-gpt-2` (`design-system.css:76`) e `restyling-gpt-3`, gli autori hanno impostato `backdrop-filter: none;` sulle card, sostituendo il vetro scuro con sfondi grigio-neri opachi (`#070809`, `#090a0c`).
   * *Motivo del Rifiuto:* Il tema del prodotto stabilito in `docs/design-system.md` è **Dark Glassmorphism** profondo e traslucido. Le trasparenze (`--glass-bg: rgba(13, 13, 13, 0.85)`), i bordi luminosi (`rgba(255, 255, 255, 0.1)`) e l'effetto sfocatura di fondo (`backdrop-filter: blur(16px)`) costituiscono l'identità del brand e non possono essere eliminati.

2. **Deriva Cromatica della Palette (Color Drifts):**
   * *Riscontro:* I rami introducono colori arbitrari:
     - Colore d'accento spostato dal magenta `#cc00ff` al viola Tailwind `#a855f7` (B1 e B2) o al cyan chiaro `#22d3ee` (B3).
     - Colore primario spostato dall'Electric Cyan `#00e5ff` a un cyan spento `#22d3ee` (B3).
     - Colori di feedback alterati (es. Danger `#fb7185` invece del canonico `#ff4d6d`, Warning `#fbbf24` invece di `#ffb703`).
   * *Motivo del Rifiuto:* `docs/design-system.md` elenca i valori esadecimali canonici immutabili: `--primary-color: #00e5ff`, `--accent-color: #cc00ff`, `--danger-color: #ff4d6d`, `--warning-color: #ffb703`, `--success-color: #2ecc71`.

3. **Iniezione di Font Esterni e Tracking Esasperato:**
   * *Riscontro:* In `restyling-gpt-1`, `index.html` e `tokens.css` caricano il font Google `Inter` applicando letter spacing estremo (`letter-spacing: -0.025em`) e font weight atipici (`820`).
   * *Motivo del Rifiuto:* LogBook si affida allo stack di caratteri nativo di sistema (`system-ui, -apple-system, sans-serif`) per garantire caricamenti istantanei offline senza latenza di rete font (FOIT/FOUT).

4. **Etichette e Badge di Branding Superflui:**
   * *Riscontro:* In `restyling-gpt-2` (`LoginBox.tsx`), è stato aggiunto un eyebrow text non richiesto: `<span className="auth-brand__mark">Training companion</span>`.
   * *Motivo del Rifiuto:* Aggiunge rumore visivo in un'interfaccia mobile che richiede la massima densità informativa e pulizia visiva.

5. **Gonfiamento dei Raggi di Curvatura (Border Radius Inflation):**
   * *Riscontro:* Arrotondamenti delle card portati a 22px-24px.
   * *Motivo del Rifiuto:* Il design system prescrive bordi compatti ed eleganti (`--border-radius: 12px`, max 16px per container grandi), preservando l'aspetto geometrico e moderno.

---

## 5. Piano Operativo di Adozione Graduale (Roadmap a Fasi)

Per integrare con successo queste migliorie in `main` senza rischi di regressione e senza deploy a vuoto, si raccomanda una roadmap strutturata in 6 fasi incrementali:

```
  FASE 1: Fondamenta Token & Guardrail (tokens.css + interaction-guardrails.css)
     │
     ▼
  FASE 2: Primitive Condivise di Shell & Nav (SectionTabs.tsx, BottomNav.tsx, App.tsx)
     │
     ▼
  FASE 3: Bonifica Auth & Overlay (LoginBox.tsx, GlobalDialog.tsx)
     │
     ▼
  FASE 4: Hardening Workout Session & Timer (WorkoutTimer.tsx, SessionHeader.tsx, Test)
     │
     ▼
  FASE 5: High-Frequency Set Rows & Exercise Card (SessionExerciseCard.tsx, SessionSetRow.tsx)
     │
     ▼
  FASE 6: Verification Gate Finale (npm run lint, test, build, test:e2e)
```

### Fase 1: Fondamenta dei Token CSS e Guardrail di Interazione
1. Creare `src/styles/tokens.css` importando la scala semantica di spaziatura (`--space-1`..`--space-10`), raggi di curvatura, z-index e motion.
2. Inserire in `tokens.css` il layer di alias legacy vincolato **esclusivamente ai colori e alle trasparenze del Dark Glassmorphism canonico** (`#000000`, `#0d0d0d`, `#00e5ff`, `#cc00ff`, `rgba(13,13,13,0.85)`).
3. Creare `src/styles/interaction-guardrails.css` fissando `--interactive-target-min: 2.75rem` (44px) e la media query per telefoni stretti.
4. Importare i due file in `src/main.tsx` subito dopo `src/styles/global.css`.
5. *Gate di Verifica:* Eseguire `npm run test` e `npm run build` per confermare l'assenza di regressioni di compilazione.

### Fase 2: Primitive Condivise e Modernizzazione della Shell
1. Introdurre `src/components/UI/SectionTabs.tsx` come componente generico tipizzato.
2. Sostituire il codice duplicato della sotto-navigazione in `TrainingView.tsx`, `NutritionView.tsx` e `DataView.tsx`.
3. Refactoring di `src/components/UI/BottomNav.tsx` con mappatura dichiarativa dell'array `NAV_ITEMS` e attributo `aria-current="page"`.
4. Refactoring dei pannelli in `src/App.tsx` utilizzando l'attributo nativo HTML `hidden` e classi `.app-tab-panel`.
5. *Gate di Verifica:* Verificare i test E2E di navigazione con Playwright.

### Fase 3: Bonifica Completa dell'Autenticazione (`LoginBox.tsx`)
1. Sostituire i 18+ stili inline in `src/components/UI/LoginBox.tsx` con le classi CSS `.auth-card`, `.auth-form`, `.auth-password-field`, etc.
2. Applicare le correzioni di Sentence case italiano ("Conferma password", "Invia link di recupero").
3. Collegare `.auth-card` al tema Dark Glassmorphism (`backdrop-filter: blur(16px)`).

### Fase 4: Workout Session e Timer di Recupero
1. Aggiornare `src/components/Training/WorkoutTimer.tsx` rimuovendo gli stili inline ed effettuando l'upgrade delle icone `▶`, `⏸`, `🔄`, `⏹` a `lucide-react` (`Play`, `Pause`, `RotateCcw`, `Square`).
2. Aggiornare `src/components/Training/SessionHeader.tsx` e `ActiveWorkoutSession.tsx`.
3. Integrare nella suite di test i nuovi file `tests/workout_timer_ui.test.tsx` e `tests/restyling_timer_invariant.test.tsx`.
4. *Gate di Verifica:* Verificare che tutti i test del timer passino al 100%.

### Fase 5: Componenti ad Alta Frequenza (Exercise Card e Set Rows)
1. Introdurre l'intestazione semantica delle colonne (`.workout-set-columns`) in `SessionExerciseCard.tsx`.
2. Aggiornare `SessionSetRow.tsx` con `inputMode="decimal"` e `inputMode="numeric"`, sostituendo il blocco inline del pulsante `+` con la classe `.workout-set-special-trigger`.
3. **Vincolo Critico:** Preservare rigorosamente i comparatori `React.memo` personalizzati (`areEqual`) e i contratti di testo E2E (`+`, `✕`, `- Rimuovi serie`).

### Fase 6: Gate di Qualità Finale
Eseguire la checklist obbligatoria di `AGENTS.md`:
```bash
npm run lint        # oxlint: 0 errori, 0 warning
npm run test        # vitest run: tutte le suite verdi
npm run build       # tsc --noEmit && vite build: build produzione pulita
npm run test:e2e    # playwright test: nessun fallimento nei flussi critici
```

---

## 6. Attestazione di Zero Modifiche al Codice e Stato Git Pulito

In piena conformità con le istruzioni operative, il protocollo di non-modifica e il read-only audit mandate:
- **Nessun file sorgente del repository è stato modificato, cancellato o sovrascritto.**
- **Nessun comando `git commit`, `git push`, `git checkout` o `git reset` è stato eseguito.**
- L'unico file generato nella radice del repository è il presente documento: `structural_improvements_report.md`.
- L'albero di lavoro su `main` rimane nello stato esatto riscontrato alla partenza, pronto per future implementazioni controllate e autorizzate dall'utente.
