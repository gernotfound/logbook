# LogBook Premium

LogBook è una Progressive Web App (PWA) estremamente strutturata e tecnicamente avanzata, sviluppata per atleti e bodybuilder che esigono un controllo assoluto e scientifico sulla propria programmazione e alimentazione. 

Non è un semplice "diario": l'app implementa logiche complesse per la periodizzazione dell'allenamento, il calcolo automatico dei fabbisogni metabolici e l'analisi granulare dei volumi di lavoro. Il tutto, avvolto in un'interfaccia "Dark Glassmorphism" pulita, priva di distrazioni e altamente reattiva.

---

## 🚀 Analisi Dettagliata delle Funzionalità

### 🏋️ 1. Motore di Allenamento (Training & Periodizzazione)
L'area di allenamento non si limita a segnare due pesi, ma gestisce vere e proprie strutture di periodizzazione:
- **Libreria Esercizi Personalizzabile**: Crea e gestisci esercizi definendo fasce muscolari, attrezzatura e tipologia.
- **Costruttore di Schede (Routines)**: Imposta esercizi, target di serie, ripetizioni, RPE (Sforzo Percepito) e tempi di recupero precisi al secondo.
- **Cicli di Allenamento (Mesocicli)**: Le schede non sono fisse. Puoi strutturarle in un "Ciclo" dinamico. L'app calcolerà automaticamente quale scheda è la prossima in base allo storico dei tuoi allenamenti.
- **Live Tracker & Cronometro**: Avvia la sessione live. Usa il cronometro integrato per i recuperi. Spunta le serie man mano che le completi.
- **Serie Speciali Avanzate**: Pieno supporto nativo per l'aggiunta in corsa di **Dropset** (serie a scalare con peso decrescente) e **Isometrie** (tenute statiche a tempo) all'interno dello stesso blocco di lavoro.
- **Analisi Volume & Massimali**: Grafici integrati (tramite Chart.js) permettono di visualizzare l'andamento del Volume Totale (kg sollevati) per sessione e l'andamento del Carico Massimale nel tempo per i singoli esercizi.

### 🍏 2. Gestione Nutrizionale di Precisione (Nutrition)
Il modulo alimentare è pensato per il "Carb Cycling" e la manipolazione dei macro:
- **Calcolo TDEE Dinamico**: Il fabbisogno calorico (Normocalorica) viene ricalcolato costantemente in base all'età, genere, peso, altezza e percentuale di massa grassa rilevata.
- **Target ON/OFF (Giorni di Allenamento e Riposo)**: Imposta i macronutrienti (in g/kg) differenziando i giorni in cui ti alleni da quelli in cui riposi. Puoi variare percentualmente i macro nei giorni "ON" rispetto a quelli "OFF", tenendo d'occhio la media settimanale e il rapporto Carboidrati/Grassi.
- **Diario Alimentare e Libreria**: Inserimento dei cibi e monitoraggio giornaliero con Progress Bar circolari e lineari che si riempiono rispetto agli obiettivi calorici e di macronutrienti calcolati per quel giorno specifico.
- **Tracker Integratori**: Sezione separata per tenere traccia della supplementazione quotidiana (Creatina, Vitamine, Omega 3, ecc.).

### 📏 3. Biometria e Composizione Corporea (Data & Biometry)
- **Stima BF% (US Navy Method)**: Calcolo automatico della massa grassa e della massa magra (FFM) tramite inserimento incrociato di peso, collo e vita/fianchi. Consente anche l'override manuale.
- **Misure Bodybuilding**: Tracciamento granulare di ogni singolo distretto muscolare: Torace, Spalle, Braccia, Cosce e Polpacci.
- **Esportazione CSV Globale**: Tutto ciò che inserisci (storico allenamenti, variazioni di peso, diari alimentari) può essere esportato istantaneamente in un file CSV formattato, pronto per Excel o analisi di terze parti.

---

## 🔒 Architettura PWA, Offline-First e Sincronizzazione

Dal punto di vista architetturale, LogBook aggira le limitazioni classiche delle web app:
- **Zero Installazione, Piena Esperienza**: Supporto totale PWA (Vite PWA Plugin) per l'installazione nella Home Screen di iOS e Android, con fix nativi per bloccare lo zoom di Safari sugli input e simulare un'app nativa.
- **Zustand Centralized Store & Debouncing**: Lo stato globale è centralizzato. Le modifiche repentine ai dati (es. la battitura dei pesi) non saturano il database: un sistema di debouncing raggruppa le mutazioni in pacchetti atomici prima dell'invio.
- **Modalità Guest (100% Offline)**: L'app lavora in locale (`localStorage`). Non richiede una connessione internet per avviare o concludere un allenamento.
- **Merge al Login (Cloud Firebase V9)**: Se l'utente decide di autenticarsi con Google Auth, la logica di login preleva tutti i dati generati offline (Guest) e fa un "merge" intelligente inviandoli a Firestore, prevenendo qualsiasi perdita di progressi e abilitando il cloud-sync multi-dispositivo.

---

## 💻 Nota per lo Sviluppo Locale (Database Privato)

Il codice sorgente è esplorabile, ma l'app fa affidamento su un backend Firebase **privato**.
Se scarichi il repository e lanci `npm run dev`:
1. Le API di salvataggio in cloud e di Google Auth **falliranno**, poiché il progetto clonato non possiede le chiavi di accesso a Firestore.
2. Tuttavia, l'app può continuare a funzionare in locale in **Modalità Guest**.
3. Per far funzionare il cloud-sync in locale, dovrai obbligatoriamente creare un tuo progetto Firebase, abilitare Auth/Firestore, e creare un file `.env` root con le tue credenziali (es. `VITE_FIREBASE_API_KEY`).
  
## Sicurezza, Offline PWA e Sviluppo AI  
LogBook e' costruito con un'architettura ibrida Offline-First e una Content-Security-Policy ferrea. Per una panoramica dettagliata sulle regole di sicurezza HTTP, il caching del Service Worker e le invarianti di sviluppo per agenti AI, consulta obbligatoriamente il file [AGENTS.md](AGENTS.md). 
