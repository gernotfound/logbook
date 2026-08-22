# Proposte e Benchmarking per la Dashboard Analitica (LogBook)

> **Documento:** Strategia, Benchmarking di Settore e Specifiche per la Dashboard Home  
> **Applicazione:** LogBook PWA (React 19, TypeScript, Zustand 5, IndexedDB + Firestore, Vanilla CSS Dark Glassmorphism)  
> **Autore:** Team di Ingegneria & Fitness Analytics Specialist  
> **Data:** Agosto 2026  
> **Stato:** Approvato per implementazione e roadmap  

---

## 1. Visione e Posizionamento Strategico

Nelle moderne applicazioni di fitness tracking e monitoraggio corporeo, la schermata principale (Home Dashboard) costituisce il punto di contatto nevralgico tra l'utente e i propri dati biometrici e prestazionali. La maggior parte dei prodotti sul mercato tratta l'allenamento con i pesi e il diario alimentare come due compartimenti stagni e disgiunti.

L'architettura di **LogBook** offre un vantaggio competitivo unico: raccoglie all'interno di un'unica struttura dati unificata (`UserData` in Zustand 5 con persistenza ibrida IndexedDB/Firestore) l'intero spettro informativo dell'atleta:
- **Dati di allenamento:** serie, ripetizioni, carichi, tipologia di carico (pesi liberi, zavorre, bodyweight, tempo, cardio), dropset, isometrie, RPE, fatica e DOMS attivi.
- **Dati nutrizionali e integratori:** apporto calorico giornaliero, macronutrienti (carboidrati, proteine, grassi), orario di assunzione dei pasti, integrazione specifica.
- **Dati biometrici e di recupero:** peso corporeo, percentuale di massa grassa, circonferenze corporee, ore di sonno complessive e stadi del sonno (profondo, REM, leggero).
- **Pianificazione a lungo termine:** cicli di allenamento periodizzati (mesocicli, rotazione schede, progressioni) e pianificazione calorica target (normocalorica, surplus controllato, deficit di definizione).

L'obiettivo strategico della Home Dashboard di LogBook è trasformare questi dati grezzi in **insight azionabili, predittivi e prescrittivi**, guidando l'atleta verso il sovraccarico progressivo ottimale e prevenendo sovrallenamento o stalli metabolici, nel pieno rispetto del design system **Dark Glassmorphism** e dei vincoli prestazionali su mobile PWA (iOS e Android).

---

## 2. Benchmarking di Mercato & Open-Source

### 2.1 Analisi Comparativa delle Applicazioni Commerciali di Riferimento

| Applicazione | Target & Focus Primario | Metriche e Visualizzazioni Cardine | Punti di Forza Riconosciuti | Limiti Strutturali & Opportunità per LogBook |
| :--- | :--- | :--- | :--- | :--- |
| **Hevy** | Social Workout Tracker & Bodybuilding Log | - Tonnellaggio settimanale (Kg totali sollevati)<br>- Spider/Radar chart della distribuzione muscolare<br>- Curva 1RM stimata per esercizio<br>- Conteggio serie allenanti per distretto | - UI mobile molto curata e fluida<br>- Grafico radar chiaro e intuitivo<br>- Ottimo calcolo del carico per muscoli secondari | - **Completamente cieco sulla nutrizione**: nessun diario calorico né correlazione tra deficit/surplus e tonnellaggio. |
| **Strong** | Minimalist Powerlifting & Strength Log | - Tonnellaggio per sessione<br>- Badge record personali (PR: peso, 1RM teorico, volume)<br>- Grafici lineari di progressione per singolo esercizio | - Inserimento dati rapido e minimale<br>- Visualizzazione immediata dei record storici | - Grafici isolati e poco integrati<br>- Nessun modello di recupero muscolare o fatica neurale. |
| **MacroFactor** | Smart Nutrition & Metabolic Expenditure Coach | - Spesa energetica dinamica (Dynamic TDEE algorithm)<br>- Trend Weight (filtraggio del rumore idrico con media esponenziale)<br>- Bilancio energetico netto (Expenditure vs Intake)<br>- Aderenza neutra senza colpevolizzazione | - **Algoritmo metabolico scientificamente inappuntabile**<br>- Netta separazione tra peso reale volatile e trend ponderale reale | - Nessun modulo di allenamento pesi nativo; non traccia volumi o progressioni di carico. |
| **RP Hypertrophy** (Renaissance Periodization) | Hypertrophy Mesocycle & Auto-regulation | - Volume Landmarks: MEV (Minimum Effective Volume), MAV (Maximum Adaptive Volume), MRV (Maximum Recoverable Volume)<br>- Feedback soggettivi post-workout (DOMS 0-3, Pump 0-3)<br>- Auto-regolazione automatica delle serie (+1/+2 serie a settimana) | - **Riferimento accademico per l'ipertrofia**<br>- Auto-regolazione del volume settimanale basata sul recupero reale | - Curva di apprendimento ripida per utenti intermedi<br>- Nessun collegamento con il timing e l'apporto calorico dei pasti. |
| **Whoop / Oura / Apple Fitness** | Wearable Readiness, Sleep & Strain Recovery | - Punteggio di Recupero / Readiness (0-100%)<br>- Calcolo del carico cardiovascolare e sonno profondo/REM<br>- Anelli di attività e streak di consistenza | - Dashboard visuale ad altissimo impatto e motivazione<br>- Correlazione scientifica tra qualità del sonno e prontezza | - Richiede hardware proprietario costoso<br>- Sottostima lo sforzo neurale/meccanico e l'affaticamento muscolare localizzato da sovraccarico. |

---

### 2.2 Analisi dei Pattern nei Repository Open-Source (GitHub)

Dallo studio dei progetti open-source più apprezzati nella community (tra cui *wger Workout Manager*, *openGym*, *SportSee Analytics*, *Modern Fitness Tracker Dashboard* e progetti analitici in React 19 / TypeScript), emergono quattro pattern architetturali e visivi fondamentali:

1. **Pattern 'KPI Summary Bar' + 'Interactive Canvas Chart':**  
   I widget di maggior successo posizionano una riga superiore con 2-3 KPI sintetici (es. Tonnellaggio settimanale, Delta percentuale rispetto alla settimana precedente, Media giornaliera) sopra al canvas del grafico. Questo garantisce leggibilità istantanea anche senza interagire con il grafico.
2. **Dual-Axis Compositions (Doppio asse Y combinato):**  
   Per correlare grandezze eterogenee (es. Volume in Kg e Introito in Kcal), la visualizzazione ottimale combina **barre verticali traslucide** per grandezze cumulative con **linee continue a gradiente d'area** per grandezze continue.
3. **Heatmap & Matrici di Recupero Visivo:**  
   Mappe termiche a griglia o sagome corporee con sfumature di colore (da verde a rosso scuro) per comunicare istantaneamente lo stato di affaticamento e i tempi di recupero ideali prima del prossimo stimolo.
4. **Ottimizzazione Prestazionale su Mobile (HTML5 Canvas vs SVG):**  
   Nei contesti PWA per smartphone (in particolare WebKit su iOS), le soluzioni basate su Canvas 2D accelerato via hardware (come `chart.js` / `react-chartjs-2`) offrono prestazioni superiori a 60fps con consumo di memoria ridotto rispetto a librerie basate su migliaia di nodi SVG nel DOM.

---

## 3. Le 5 Proposte Strutturate per Nuovi Widget e Metriche

Di seguito vengono presentate 5 proposte dettagliate e pronte per l'implementazione, ciascuna corredata da modello matematico, mappatura dello stato Zustand, specifiche UI/UX nel tema Dark Glassmorphism e convenzioni linguistiche in sentence case italiano.

---

### Proposta 1: Mappa termica di recupero e fatica muscolare (*Muscle recovery & fatigue heatmap*)

#### 1. Obiettivo & Benchmark
Fornire all'atleta una stima visiva immediata dello stato di prontezza e recupero biologico dei principali gruppi muscolari (Petto, Dorso, Spalle, Bicipiti, Tricipiti, Quadricipiti, Femorali, Polpacci, Addome), combinando il volume recente svolto con il decadimento temporale e le segnalazioni soggettive di dolori muscolari (DOMS).  
*Benchmark di riferimento:* RP Hypertrophy + Whoop + Modello muscolare SVG integrato in LogBook.

#### 2. Mappatura dello Stato Zustand (`UserData`)
- `userData.history`: sessioni di allenamento registrate negli ultimi 7 giorni con timestamp di esecuzione (`globalEndTime`).
- `userData.library`: anagrafica degli esercizi con mappatura dei muscoli primari (`muscles`) e secondari (`secondaryMuscles`).
- `userData.activePains`: array di muscoli contrassegnati dall'utente come doloranti o infiammati.

#### 3. Formulazione Matematica & Logica Algoritmica
1. **Accumulo dello stimolo con decadimento esponenziale:**  
   Per ogni gruppo muscolare $m$, la fatica accumulata $\text{Fatigue}_m(t)$ a distanza di $t$ ore dall'ultimo allenamento è data da:
   $$\text{Fatigue}_{m}(t) = \sum_{s \in S_m} \left( \text{Sets}_{\text{primari}} \times 1.0 + \text{Sets}_{\text{secondari}} \times 0.5 \right) \cdot e^{-\lambda \cdot t}$$
   dove l'emivita di recupero è impostata su $\tau = 36\text{ ore}$, per cui la costante di decadimento è:
   $$\lambda = \frac{\ln(2)}{36} \approx 0.01925\text{ h}^{-1}$$
2. **Penalizzazione per dolori attivi (DOMS):**  
   Se il muscolo $m \in \text{activePains}$, il valore di fatica subisce una maggiorazione del $+40\%$:
   $$\text{Fatigue}_{m,\text{effettiva}} = \text{Fatigue}_m(t) \times 1.40$$
3. **Normalizzazione e classificazione in 3 stati:**
   - **Recuperato / Pronto:** $\text{Fatigue} < 25\%$ $\rightarrow$ Colore `var(--success-color)` (`#2ecc71`)
   - **In recupero fisiologico:** $25\% \le \text{Fatigue} \le 60\%$ $\rightarrow$ Colore `var(--warning-color)` (`#ffb703`)
   - **Affaticato / Sovraccarico:** $\text{Fatigue} > 60\%$ $\rightarrow$ Colore `var(--danger-color)` (`#ff4d6d`)

#### 4. Specifiche UI/UX & Dark Glassmorphism
- **Container:** `.card` in vetro scuro (`backdrop-filter: blur(10px); background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 16px;`).
- **Layout:** Header con titolo in sentence case (*"Stato di recupero muscolare"*) e pillola con lo stato globale (*"5 muscoli pronti all'uso"*). Corpo diviso a metà: a sinistra mini sagoma SVG del corpo umano illuminata con accenti colorati, a destra elenco dei distretti con mini-barre orizzontali di percentuale di recupero.
- **Interazione touch:** Toccando un muscolo si apre un dettaglio con il tempo trascorso (es. *"Dorso: allenato 26 ore fa (10 serie) • Recupero stimato: 68%"*).

---

### Proposta 2: Trend settimanale volume vs surplus/deficit calorico (*Weekly volume vs caloric balance trend*)

#### 1. Obiettivo & Benchmark
Mettere in correlazione diretta l'energia introdotta con l'alimentazione (surplus ipercalorico o restrizione calorica) e il volume complessivo di lavoro meccanico sostenuto settimana per settimana. Permette all'atleta e al coach di verificare se un calo di prestazione sia imputabile a un deficit calorico troppo aggressivo o se un surplus stia producendo il desiderato incremento di volume allenante.  
*Benchmark di riferimento:* MacroFactor + Hevy Analytics.

#### 2. Mappatura dello Stato Zustand (`UserData`)
- `userData.history`: sessioni svolte con calcolo del tonnellaggio esatto tramite `calculateWorkoutVolume` (in `src/lib/calc/workout.ts`).
- `userData.nutrition`: registro nutrizionale giornaliero con le calorie totali (`kcal`) per data.
- `userData.nutritionPlanning` e `Logic.calculateTDEE`: spesa energetica di mantenimento stimata.

#### 3. Formulazione Matematica & Logica Algoritmica
1. **Aggregazione su base settimanale (ultime 6-12 settimane):**
   - **Tonnellaggio settimanale ($V_{\text{week}}$):**
     $$V_{\text{week}} = \sum_{d \in \text{settimana}} \sum_{\text{set} \in d} (\text{peso} \times \text{reps})$$
   - **Introito calorico medio settimanale ($\text{KcalAvg}_{\text{week}}$):**
     $$\text{KcalAvg}_{\text{week}} = \frac{1}{N_{\text{log}}} \sum_{d \in \text{settimana}} \text{Kcal}_d$$
   - **Bilancio energetico netto ($\Delta E_{\text{week}}$):**
     $$\Delta E_{\text{week}} = \text{KcalAvg}_{\text{week}} - \text{TDEE}_{\text{week}}$$
2. **Visualizzazione a doppio asse Y (Chart.js):**
   - **Asse sinistro ($Y_1$ - Barre verticali):** Volume totale (Kg) con colore primario `var(--primary-color)` (`#00e5ff`) a opacità 0.8 e bordi smussati (`borderRadius: 6`).
   - **Asse destro ($Y_2$ - Linea continua con area):** Bilancio calorico ($\Delta E$ in kcal/giorno) con linea viola `var(--accent-color)` (`#cc00ff`) per i valori positivi (surplus) e sfumatura arancione `var(--warning-color)` (`#ffb703`) per i valori negativi (deficit). Linea di zero neutra tratteggiata (`rgba(255, 255, 255, 0.2)`).

#### 4. Specifiche UI/UX & Dark Glassmorphism
- **Container:** `.card` ad altezza 260px con controlli di intervallo temporale (4, 8, 12 settimane) integrati nell'angolo superiore destro tramite segmented control a pillola.
- **Header:** Titolo in sentence case (*"Volume settimanale e bilancio energetico"*) con riga di sintesi (*"Media: 19.200 kg/settimana • Bilancio: +150 kcal/giorno"*).
- **Tooltip interattivo:** Tooltip in dark glass con bordo neon che scompone la settimana toccata: tonnellaggio totale sollevato, numero di sessioni completate, calorie medie giornaliere e surplus/deficit calcolato rispetto al fabbisogno di mantenimento.

---

### Proposta 3: Tracker del sovraccarico progressivo e massimale stimato (*Progressive overload & e1RM PR tracker*)

#### 1. Obiettivo & Benchmark
Monitorare l'adattamento neuromuscolare e l'incremento di forza massimale teorica sui sollevamenti fondamentali (es. Panca piana, Squat, Stacco da terra, Military press, Trazioni zavorrate), calcolando automaticamente l'1RM stimato (e1RM) e notificando all'istante nuovi record personali (PR).  
*Benchmark di riferimento:* Strong + Hevy + Formule scientifiche Epley e Brzycki.

#### 2. Mappatura dello Stato Zustand (`UserData`)
- `userData.history`: serie svolte per esercizio con carichi, ripetizioni, peso corporeo e zavorre.
- `userData.library`: catalogo esercizi con proprietà `isBodyweight`, `equipmentWeight` e `trackingType`.

#### 3. Formulazione Matematica & Logica Algoritmica
1. **Calcolo dell'1RM stimato (Modello ibrido ottimizzato):**
   - Per serie ad alta intensità ($\le 10$ ripetizioni, modello di Epley):
     $$\text{e1RM} = \text{Carico Effettivo} \times \left(1 + \frac{\text{Ripetizioni}}{30}\right)$$
   - Per serie ad alto volume ($> 10$ ripetizioni, modello di Brzycki):
     $$\text{e1RM} = \text{Carico Effettivo} \times \frac{36}{37 - \text{Ripetizioni}}$$
2. **Determinazione dei Personal Record (PR):**
   - **Weight PR:** Carico massimo assoluto mai sollevato.
   - **e1RM PR:** Miglior massimale stimato calcolato.
   - **Volume PR:** Massimo tonnellaggio sviluppato su un singolo esercizio all'interno di una sessione.
3. **Indice di progressione del mesociclo ($\Delta_{\text{prog}}$):**
   $$\Delta_{\text{prog}} = \frac{\text{e1RM}_{\text{max, settimana corrente}} - \text{e1RM}_{\text{settimana 1}}}{\text{e1RM}_{\text{settimana 1}}} \times 100$$

#### 4. Specifiche UI/UX & Dark Glassmorphism
- **Container:** `.card` con selettore orizzontale a scorrimento (chip badge) dei 5 esercizi preferiti o registrati nel ciclo attivo.
- **Header:** Titolo in sentence case (*"Progressione massimali ed e1RM"*) con badge dorato lucido in caso di nuovo PR recente (*"🏆 Nuovo record su panca piana: 112.5 kg"*).
- **Grafico:** Curva di progressione lineare con punti evidenziati tramite anelli luminosi (`box-shadow: 0 0 10px var(--primary-glow)`) nei giorni in cui è stato stabilito un record.

---

### Proposta 4: Indice di consistenza e prontezza metabolica (*Consistency & metabolic readiness score*)

#### 1. Obiettivo & Benchmark
Offrire un meta-punteggio sintetico (da 0 a 100) che valuti l'aderenza dell'atleta su tre pilastri determinanti: costanza delle sessioni rispetto alla pianificazione, aderenza calorico-nutrizionale e qualità del sonno/recupero notturno.  
*Benchmark di riferimento:* Whoop Recovery Score + Apple Fitness Activity Rings + Oura Readiness.

#### 2. Mappatura dello Stato Zustand (`UserData`)
- `userData.history`: sessioni completate negli ultimi 14 giorni vs target settimanale del ciclo attivo (`trainingCycles`).
- `userData.nutrition`: giorni con tracking completo e aderenza al target calorico (tolleranza $\pm 10\%$).
- `userData.nutrition[date].sleepHours` e `sleepDeep`: ore totali di sonno e percentuale di sonno profondo.

#### 3. Formulazione Matematica & Logica Algoritmica
Il punteggio complessivo $\text{Readiness} \in [0, 100]$ è calcolato come media ponderata:
$$\text{Readiness Score} = (0.40 \times S_{\text{allenamento}}) + (0.35 \times S_{\text{nutrizione}}) + (0.25 \times S_{\text{sonno}})$$
- **Score Allenamento ($S_{\text{allenamento}}$ - 40%):**
  $$S_{\text{allenamento}} = \min\left(100, \frac{\text{Sessioni svolte negli ultimi 7 giorni}}{\text{Sessioni target del ciclo attivo}} \times 100\right)$$
- **Score Nutrizione ($S_{\text{nutrizione}}$ - 35%):**
  Percentuale di giorni negli ultimi 7 giorni con apporto calorico entro l'intervallo $[0.90 \times \text{Target}, 1.10 \times \text{Target}]$.
- **Score Sonno ($S_{\text{sonno}}$ - 25%):**
  $$S_{\text{sonno}} = \min\left(100, \frac{\text{Ore medie sonno (7gg)}}{8.0} \times 80 + \frac{\text{Quota sonno profondo}}{0.20} \times 20\right)$$

#### 4. Specifiche UI/UX & Dark Glassmorphism
- **Container:** `.card` con indicatore radiale circolare (anelli concentrici o progress ring con gradiente da `var(--primary-color)` a `var(--accent-color)`).
- **Valore centrale:** Numero a caratteri grandi (*"86"*) con etichetta di stato in sentence case: *"Prontezza ottima"*, *"Aderenza buona"* o *"Recupero raccomandato"*.
- **Breakdown analitico:** 3 barre di progresso orizzontali sottili per Allenamento (Ciano), Nutrizione (Viola) e Sonno (Verde smeraldo).

---

### Proposta 5: Bilanciamento macronutrienti e finestra peri-workout (*Macro balance & peri-workout nutrient timing*)

#### 1. Obiettivo & Benchmark
Monitorare la corretta distribuzione dei nutrienti nell'arco della giornata in relazione all'orario in cui si svolge la sessione di allenamento, garantendo scorte glucidiche ottimali prima dello sforzo e un apporto proteico adeguato a stimolare la sintesi proteica muscolare (MPS) nelle ore successive.  
*Benchmark di riferimento:* MacroFactor + Cronometer.

#### 2. Mappatura dello Stato Zustand (`UserData`)
- `userData.nutrition[date].meals`: lista dei pasti consumati con orario di registrazione (`time`), calorie, carboidrati, proteine e grassi.
- `userData.history`: orario di inizio (`globalStartTime`) e fine (`globalEndTime`) dell'allenamento del giorno.

#### 3. Formulazione Matematica & Logica Algoritmica
1. **Finestra Pre-workout (da -3.0h a -30min prima dell'inizio):**  
   Calcolo dei grammi di carboidrati assunti: target raccomandato $\ge 0.5 - 1.0\text{ g/kg}$ di peso corporeo.
2. **Finestra Post-workout (da 0 a +2.5h dalla fine della sessione):**  
   Calcolo dei grammi di proteine nobili assunte: target raccomandato $\ge 0.35 - 0.5\text{ g/kg}$ (soglia di saturazione leucina ~3-4g).
3. **Distribuzione oraria (Timeline 24h):**  
   Mappatura dei pasti e dell'allenamento su un asse temporale continuo per evidenziare eventuali digiuni prolungati pre o post allenamento.

#### 4. Specifiche UI/UX & Dark Glassmorphism
- **Container:** `.card` con visualizzazione a timeline orizzontale (fascia 06:00 - 24:00).
- **Timeline grafica:** La durata della sessione di allenamento è rappresentata da un blocco luminoso azzurro (`rgba(0, 229, 255, 0.2)` con bordo `var(--primary-color)`). I pasti compaiono come pillole interattive con indicazione oraria e grammature macro (es. *"Spuntino 16:30: 45g C • 25g P"*).
- **Messaggio di feedback:** Box sintetico con icona di spunta: *"Finestra peri-workout rispettata: apporto glucidico e proteico ideale per il recupero"*.

---

## 4. Specifiche UI/UX & Dark Glassmorphism Design System

Tutti i widget proposti sono conformi al 100% con il Design System di LogBook e con i vincoli descritti in `AGENTS.md` e `src/styles/global.css`:

### 4.1 Palette Colori e Variabili CSS di Sistema
```css
:root {
  /* Sfondi e superfici */
  --bg-color: #000000;
  --surface-color: #0d0d0d;
  --surface-light: #1a1a1a;

  /* Colori di accento e grafici */
  --primary-color: #00e5ff;             /* Ciano brillante per metriche di allenamento */
  --primary-glow: rgba(0, 229, 255, 0.3);
  --accent-color: #cc00ff;              /* Magenta/Viola per nutrizione e calorie */

  /* Feedback semantico e stati */
  --success-color: #2ecc71;            /* Verde per recupero completato / target raggiunto */
  --warning-color: #ffb703;            /* Ambra per recupero parziale / deficit calorico */
  --danger-color: #ff4d6d;             /* Rosso corallo per sovraccarico / DOMS attivi */

  /* Effetti vetro e bordi */
  --glass-bg: rgba(13, 13, 13, 0.85);
  --glass-border: rgba(255, 255, 255, 0.1);
  --border-radius: 16px;

  /* Tipografia */
  --text-main: #f0f0f0;
  --text-muted: #9ba3af;
}
```

### 4.2 Regole di Layout & Mobile Usability (iOS & PWA)
- **Container standard `.card`:** Padding fisso di `20px` (`var(--spacing)`), `backdrop-filter: blur(10px)`, bordo sottile in vetro e ombreggiatura morbida.
- **Prevenzione overflow Flexbox:** Tutti i container con layout `display: flex` devono applicare `min-width: 0` agli elementi figli per prevenire lo sfondamento orizzontale su schermi stretti (es. iPhone 13 mini / SE).
- **Prevenzione zoom Safari iOS:** Tutti i controlli interattivi, selettori e campi numerici devono avere `font-size: 16px !important` nel CSS per inibire lo zoom automatico di Safari.
- **Segmented Control a pillola:** I selettori temporali (es. 4 sett, 8 sett, 12 sett) utilizzano elementi compatti con raggio di curvatura di `8px`, sfondo `rgba(255, 255, 255, 0.05)` e transizione a `0.2s ease`.

### 4.3 Stile Linguistico (Sentence Case Italiano)
In ossequio al Capitolo 11 di `AGENTS.md`, ogni testo rivolto all'utente (titoli, etichette, bottoni, messaggi di stato) adotta rigorosamente il sentence case italiano:
- ✅ **Corretto:** *"Volume settimanale e bilancio energetico"*, *"Stato di recupero muscolare"*, *"Progressione massimali ed e1RM"*, *"Indice di consistenza e prontezza"*, *"Finestra peri-workout"*.
- ❌ **Scorretto:** *"Volume Settimanale E Bilancio Energetico"*, *"Muscle Recovery Heatmap"*, *"Nuovo Record Personale"*.

---

## 5. Matrice di Prioritizzazione e Roadmap di Rilascio

| Widget / Metrica | Valore Utente | Complessità Algoritmica | Dipendenze di Stato | Fase di Rilascio Suggerita |
| :--- | :---: | :---: | :--- | :---: |
| **Volume settimanale di allenamento (Tonnellaggio)** | Alto | Bassa | `history`, `library` | **Fase 1 (Requisito R3 - Corrente)** |
| **Correlazione Volume vs Calorie settimanali** | Altissimo | Media | `history`, `nutrition`, `TDEE` | **Fase 1 (Requisito R4 - Corrente)** |
| **Tracker sovraccarico progressivo & e1RM PR** | Alto | Media | `history`, `library` | **Fase 2 (V1.1 Prossima)** |
| **Mappa termica di recupero muscolare (Heatmap)** | Altissimo | Alta | `history`, `library`, `activePains` | **Fase 2 (V1.1 Prossima)** |
| **Indice di consistenza & prontezza metabolica** | Alto | Media | `history`, `nutrition`, `sleep` | **Fase 3 (V1.2 Futura)** |
| **Finestra peri-workout e timing macronutrienti** | Medio | Alta | `nutrition.meals`, `history.times` | **Fase 3 (V1.2 Futura)** |

---

## 6. Conclusioni Tecniche per l'Ingegneria

1. **Stack grafico ufficiale:** L'utilizzo confermato di `chart.js` (^4.5.1) e `react-chartjs-2` (^5.3.1) garantisce la massima efficienza su mobile e PWA, evitando duplicazioni di bundle e preservando la compatibilità con React 19 e Vite.
2. **Centralizzazione dei calcoli puri:** Tutte le funzioni matematiche per il calcolo del volume (`calculateWorkoutVolume`) e delle metriche nutrizionali (`calculateTDEE`) risiedono nella directory `src/lib/calc/`, assicurando testabilità unitaria al 100% con Vitest.
3. **Resilienza offline:** I dati calcolati e renderizzati attingono direttamente dallo stato unificato di Zustand, garantendo funzionamento istantaneo in modalità offline su cache IndexedDB e sincronizzazione trasparente con Firestore.
