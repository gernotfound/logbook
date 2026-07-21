import { Logic } from './logic.js';
import { DB } from './db.js';
import { auth, provider, signInWithPopup, onAuthStateChanged } from './firebase-config.js';

const App = {
    state: {
        profile: { dob: '', height: '', gender: 'M' },
        library: [],      
        routines: [],     
        activeWorkout: null, 
        history: [],      
        nutrition: {}     
    },

    init() {
        // Ascolta lo stato di autenticazione Firebase
        onAuthStateChanged(auth, async (user) => {
            const authOverlay = document.getElementById('auth-overlay');
            const mainApp = document.getElementById('app-container');
            
            if (user) {
                // Utente Loggato
                authOverlay.style.display = 'none';
                mainApp.style.display = 'block';
                await this.loadDataFromCloud();
                
                document.getElementById('nutri-date').value = new Date().toISOString().split('T')[0];
                this.timers.initLoop();
                this.renderAll();
                this.renderNewExMuscles(); // Assicura che l'SVG vuoto venga renderizzato all'avvio
            } else {
                // Utente Non Loggato
                authOverlay.style.display = 'flex';
                document.getElementById('auth-loading').style.display = 'none';
                document.getElementById('auth-login-box').style.display = 'block';
                mainApp.style.display = 'none';
            }
        });
        
        // Collega i bottoni del login/logout
        document.getElementById('btn-login-google').addEventListener('click', () => {
            signInWithPopup(auth, provider).catch(error => {
                console.error("Errore di Login:", error);
                alert("Errore durante il login con Google.");
            });
        });
        
        document.getElementById('btn-logout').addEventListener('click', () => {
            DB.secureLogOut();
        });
        
        document.getElementById('btn-delete-account').addEventListener('click', () => {
            const answer = prompt('ATTENZIONE: Stai per eliminare per sempre tutti i tuoi dati e il tuo account.\nScrivi "elimina account" per confermare:');
            if(answer && answer.trim().toLowerCase() === "elimina account") {
                DB.deleteAccount();
            } else if (answer !== null) {
                alert("Testo non corrispondente. Operazione annullata.");
            }
        });
    },

    async loadDataFromCloud() {
        const cloudData = await DB.loadUserData();
        if (cloudData) {
            this.state = Object.assign(this.state, cloudData);
            this.sortLibraryAndRoutines();
        } else {
            // Struttura iniziale se l'utente è nuovo
            this.state.profile = { dob: '', height: '', gender: 'M' };
        }
    },

    showAppStatus() {
        const isOnline = navigator.onLine ? "Online 🟢" : "Offline 🔴";
        const version = "v1.0.8"; // Sincronizzato con sw.js
        alert(`Stato Applicazione\n\nVersione: ${version}\nStato Rete: ${isOnline}`);
    },


    // Salva nel cloud (Debounce per ottimizzare le scritture ed evitare di superare la quota)
    saveTimeout: null,
    saveToStorage() { 
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        
        // Mostra un piccolo indicatore visivo se lo desideri (opzionale)
        const btnLogout = document.getElementById('btn-logout');
        if(btnLogout) btnLogout.innerText = "Salvataggio in corso...";

        this.saveTimeout = setTimeout(() => {
            DB.saveUserData(this.state).then(() => {
                if(btnLogout) btnLogout.innerText = "Esci dall'account";
            });
        }, 1500); // Aspetta 1.5 secondi dall'ultima modifica prima di inviare al cloud
    },

    validateInput(input, type) {
        input.value = Logic.validateInputData(input.value, type);
    },

    toggleUI(id) {
        const el = document.getElementById(id);
        if(el) el.style.display = (el.style.display === 'none') ? 'block' : 'none';
    },

    sortLibraryAndRoutines() {
        this.state.library.sort((a, b) => a.name.localeCompare(b.name));
        this.state.routines.sort((a, b) => a.name.localeCompare(b.name));
    },

    // --- NAVIGAZIONE ---
    switchMainTab(tabName) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.getElementById('view-' + tabName).classList.add('active');
        const navs = document.querySelectorAll('.nav-item');
        if (tabName === 'home') navs[0].classList.add('active');
        if (tabName === 'training') navs[1].classList.add('active');
        if (tabName === 'nutrition') navs[2].classList.add('active');
        if (tabName === 'data') navs[3].classList.add('active');
        this.renderAll();
    },
    switchTrainingTab(subTab, btnElement) {
        document.querySelectorAll('.training-sub-view').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.sub-nav-btn').forEach(el => el.classList.remove('active'));
        document.getElementById('sub-' + subTab).classList.add('active');
        btnElement.classList.add('active');
    },

    // --- TIMERS ---
    timers: {
        restStartTime: 0, restAccumulated: 0, restState: 'stopped',
        lastRestStr: '', lastGlobalStr: '',
        initLoop() { 
            const loop = () => {
                App.timers.updateDisplay();
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        },
        updateDisplay() {
            if (this.restState === 'running') {
                const elapsed = Date.now() - this.restStartTime + this.restAccumulated;
                const str = Logic.formatTime(elapsed);
                if (str !== this.lastRestStr) {
                    const el = document.getElementById('rest-timer-display');
                    if(el) el.innerText = str;
                    this.lastRestStr = str;
                }
            }
            if (App.state.activeWorkout && App.state.activeWorkout.globalStartTime) {
                const elapsed = Date.now() - App.state.activeWorkout.globalStartTime;
                const str = Logic.formatTime(elapsed, true);
                if (str !== this.lastGlobalStr) {
                    const el = document.getElementById('global-timer-display');
                    if(el) el.innerText = str;
                    this.lastGlobalStr = str;
                }
            }
        },
        startRest() { if(this.restState !== 'running') { this.restStartTime = Date.now(); this.restState = 'running'; } },
        pauseRest() { if(this.restState === 'running') { this.restAccumulated += (Date.now() - this.restStartTime); this.restState = 'paused'; } },
        stopRest() { this.restState = 'stopped'; this.restAccumulated = 0; document.getElementById('rest-timer-display').innerText = "00:00"; this.lastRestStr = "00:00"; },
        resetRest() { this.restAccumulated = 0; this.restStartTime = Date.now(); this.restState = 'running'; }
    },

    // --- ARCHIVIO ESERCIZI ---
    tempNewExMuscles: [],

    filterMuscleSearch(query) {
        const resContainer = document.getElementById('new-ex-muscle-results');
        if(!query.trim()) { resContainer.style.display = 'none'; return; }
        
        const q = query.toLowerCase();
        const filtered = Logic.MUSCLES.filter(m => m.name.toLowerCase().includes(q) && !this.tempNewExMuscles.includes(m.id));
        
        if(filtered.length === 0) { resContainer.style.display = 'none'; return; }
        
        resContainer.style.display = 'block';
        let html = '';
        filtered.forEach(m => {
            html += `<div class="search-item" onclick="App.addMuscleToNewEx('${m.id}')">${m.name}</div>`;
        });
        resContainer.innerHTML = html;
    },

    addMuscleToNewEx(mId) {
        if(!this.tempNewExMuscles.includes(mId)) {
            this.tempNewExMuscles.push(mId);
            this.renderNewExMuscles();
        }
        document.getElementById('new-ex-muscle-search').value = '';
        document.getElementById('new-ex-muscle-results').style.display = 'none';
    },

    removeMuscleFromNewEx(mId) {
        this.tempNewExMuscles = this.tempNewExMuscles.filter(id => id !== mId);
        this.renderNewExMuscles();
    },

    renderNewExMuscles() {
        const container = document.getElementById('new-ex-selected-muscles');
        if(!container) return;
        let html = '';
        this.tempNewExMuscles.forEach(mId => {
            const m = Logic.MUSCLES.find(x => x.id === mId);
            if(m) {
                html += `<span style="background:var(--primary-color); color:#fff; padding:4px 8px; border-radius:12px; font-size:0.8rem; display:flex; align-items:center; gap:5px;">
                    ${m.name} <span style="cursor:pointer; font-weight:bold;" onclick="App.removeMuscleFromNewEx('${m.id}')">×</span>
                </span>`;
            }
        });
        container.innerHTML = html;
        this.renderSVG('new-ex-svg-container', this.tempNewExMuscles);
    },

    renderSVG(containerId, activeMusclesIds) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const template = document.getElementById('muscle-map-template');
        if(!template) return;
        
        container.innerHTML = '';
        const clone = template.content.cloneNode(true);
        
        activeMusclesIds.forEach(mId => {
                        const GROUP_MAP = {
                'abductors': ['gluteus-medius-left', 'gluteus-medius-right'],
                'abductors_left': ['gluteus-medius-left'],
                'abductors_right': ['gluteus-medius-right'],
                'abs': ['abs-lower-left', 'abs-lower-right', 'abs-upper-left', 'abs-upper-right'],
                'abs_lower': ['abs-lower-left', 'abs-lower-right'],
                'abs_upper': ['abs-upper-left', 'abs-upper-right'],
                'adductors': ['adductors-left_1', 'adductors-left_2', 'adductors-right_1', 'adductors-right_2'],
                'back': ['lats-lower-left', 'lats-lower-right', 'lats-mid-left', 'lats-mid-right', 'lats-upper-left', 'lats-upper-right', 'lower-back-erectors-left', 'lower-back-erectors-right', 'lower-back-ql-left', 'lower-back-ql-right', 'nape_1', 'nape_2', 'spine', 'traps-lower-left', 'traps-lower-right', 'traps-mid-left', 'traps-mid-right', 'traps-upper-left', 'traps-upper-right'],
                'biceps': ['biceps-left_1', 'biceps-left_2', 'biceps-left_3', 'biceps-right_1', 'biceps-right_2', 'biceps-right_3'],
                'biceps_left': ['biceps-left_1', 'biceps-left_2', 'biceps-left_3'],
                'biceps_long': ['biceps-left_1', 'biceps-left_2', 'biceps-left_3', 'biceps-right_1', 'biceps-right_2', 'biceps-right_3'],
                'biceps_right': ['biceps-right_1', 'biceps-right_2', 'biceps-right_3'],
                'biceps_short': ['biceps-left_1', 'biceps-left_2', 'biceps-left_3', 'biceps-right_1', 'biceps-right_2', 'biceps-right_3'],
                'brachialis': ['biceps-left_1', 'biceps-left_2', 'biceps-left_3', 'biceps-right_1', 'biceps-right_2', 'biceps-right_3'],
                'calves': ['calves-gastroc-lateral-left', 'calves-gastroc-lateral-right', 'calves-gastroc-medial-left', 'calves-gastroc-medial-right', 'calves-soleus-left', 'calves-soleus-right'],
                'chest': ['chest-lower-left', 'chest-lower-right', 'chest-upper-left', 'chest-upper-right'],
                'chest_left': ['chest-lower-left', 'chest-upper-left'],
                'chest_lower': ['chest-lower-left', 'chest-lower-right'],
                'chest_right': ['chest-lower-right', 'chest-upper-right'],
                'chest_upper': ['chest-upper-left', 'chest-upper-right'],
                'core': ['abs-lower-left', 'abs-lower-right', 'abs-upper-left', 'abs-upper-right', 'lower-back-erectors-left', 'lower-back-erectors-right', 'lower-back-ql-left', 'lower-back-ql-right', 'obliques-left_1', 'obliques-left_2', 'obliques-left_3', 'obliques-right_1', 'obliques-right_2', 'obliques-right_3'],
                'delts_front': ['shoulder-front-left_1', 'shoulder-front-left_2', 'shoulder-front-right_1', 'shoulder-front-right_2'],
                'delts_rear': ['deltoid-rear-left', 'deltoid-rear-right'],
                'delts_side': ['shoulder-side-left_1', 'shoulder-side-left_2', 'shoulder-side-right_1', 'shoulder-side-right_2'],
                'forearms': ['forearm-extensors-left', 'forearm-extensors-right', 'forearm-flexors-left', 'forearm-flexors-right', 'forearm-left_1', 'forearm-left_2', 'forearm-right_1', 'forearm-right_2', 'hand-left', 'hand-right'],
                'forearms_left': ['forearm-extensors-left', 'forearm-flexors-left', 'forearm-left_1', 'forearm-left_2', 'hand-left'],
                'forearms_right': ['forearm-extensors-right', 'forearm-flexors-right', 'forearm-right_1', 'forearm-right_2', 'hand-right'],
                'glutes': ['gluteus-maximus-left', 'gluteus-maximus-right', 'gluteus-medius-left', 'gluteus-medius-right'],
                'glutes_left': ['gluteus-maximus-left', 'gluteus-medius-left'],
                'glutes_right': ['gluteus-maximus-right', 'gluteus-medius-right'],
                'hamstrings': ['hamstrings-lateral-left', 'hamstrings-lateral-right', 'hamstrings-medial-left', 'hamstrings-medial-right'],
                'hand_flexors_left': ['forearm-flexors-left', 'hand-left'],
                'hand_flexors_right': ['forearm-flexors-right', 'hand-right'],
                'lats': ['lats-lower-left', 'lats-lower-right', 'lats-mid-left', 'lats-mid-right', 'lats-upper-left', 'lats-upper-right'],
                'lower_back': ['lower-back-erectors-left', 'lower-back-erectors-right', 'lower-back-ql-left', 'lower-back-ql-right', 'spine'],
                'obliques': ['obliques-left_1', 'obliques-left_2', 'obliques-left_3', 'obliques-right_1', 'obliques-right_2', 'obliques-right_3', 'serratus-anterior-left_1', 'serratus-anterior-left_2', 'serratus-anterior-left_3', 'serratus-anterior-left_4', 'serratus-anterior-right_1', 'serratus-anterior-right_2', 'serratus-anterior-right_3', 'serratus-anterior-right_4'],
                'quads': ['quads-left_1', 'quads-left_2', 'quads-left_3', 'quads-right_1', 'quads-right_2', 'quads-right_3'],
                'rhomboids': ['traps-mid-left', 'traps-mid-right'],
                'shoulders': ['deltoid-rear-left', 'deltoid-rear-right', 'shoulder-front-left_1', 'shoulder-front-left_2', 'shoulder-front-right_1', 'shoulder-front-right_2', 'shoulder-side-left_1', 'shoulder-side-left_2', 'shoulder-side-right_1', 'shoulder-side-right_2'],
                'traps': ['nape_1', 'nape_2', 'traps-lower-left', 'traps-lower-right', 'traps-mid-left', 'traps-mid-right', 'traps-upper-left', 'traps-upper-right'],
                'triceps': ['triceps-lateral-left', 'triceps-lateral-right', 'triceps-long-left', 'triceps-long-right'],
                'triceps_lateral': ['triceps-lateral-left', 'triceps-lateral-right'],
                'triceps_left': ['triceps-lateral-left', 'triceps-long-left'],
                'triceps_long': ['triceps-long-left', 'triceps-long-right'],
                'triceps_medial': ['triceps-long-left', 'triceps-long-right'],
                'triceps_right': ['triceps-lateral-right', 'triceps-long-right'],
            };
            
            let svgIds = GROUP_MAP[mId] || [mId];
            
            svgIds.forEach(sid => {
                const el = clone.getElementById(sid);
                if (el) el.classList.add('active');
            });
        });
        container.appendChild(clone);
    },

    editingExerciseId: null,

    createExerciseInLibrary() {
        const nameInput = document.getElementById('new-ex-name');
        const notesInput = document.getElementById('new-ex-notes');
        const name = nameInput.value.trim();
        if(!name) return alert("Inserisci un nome.");

        if(this.editingExerciseId) {
            // Aggiorna esistente
            if(this.state.library.some(e => e.id !== this.editingExerciseId && e.name.toLowerCase() === name.toLowerCase())) {
                return alert("Nome esercizio già esistente!");
            }
            const ex = this.state.library.find(e => e.id === this.editingExerciseId);
            if(ex) {
                ex.name = name;
                ex.notes = notesInput.value;
                ex.muscles = [...this.tempNewExMuscles];
            }
            this.editingExerciseId = null;
            document.getElementById('new-ex-title').innerText = "Nuovo Esercizio";
            document.getElementById('btn-save-exercise').innerText = "+ Aggiungi in Archivio";
            document.getElementById('btn-cancel-edit').style.display = "none";
        } else {
            // Crea nuovo
            if(this.state.library.some(e => e.name.toLowerCase() === name.toLowerCase())) {
                return alert("Esercizio già esistente!");
            }
            this.state.library.push({ 
                id: Logic.generateId('ex'), 
                name, 
                notes: notesInput.value,
                muscles: [...this.tempNewExMuscles]
            });
        }
        
        this.tempNewExMuscles = [];
        this.renderNewExMuscles();

        this.sortLibraryAndRoutines(); this.saveToStorage();
        nameInput.value = ''; notesInput.value = '';
        this.renderLibrary(); this.renderRoutineBuilder();
    },
    
    editLibraryEx(id) {
        const ex = this.state.library.find(e => e.id === id);
        if(!ex) return;
        
        document.getElementById('new-ex-name').value = ex.name;
        document.getElementById('new-ex-notes').value = ex.notes || '';
        this.tempNewExMuscles = [...(ex.muscles || [])];
        
        this.editingExerciseId = id;
        document.getElementById('new-ex-title').innerText = "Modifica Esercizio";
        document.getElementById('btn-save-exercise').innerText = "Aggiorna";
        document.getElementById('btn-cancel-edit').style.display = "block";
        
        this.renderNewExMuscles();
        
        // Scroll in alto alla form di modifica
        document.getElementById('sub-exercises').scrollIntoView({behavior: 'smooth', block: 'start'});
    },
    cancelEditExercise() {
        this.editingExerciseId = null;
        document.getElementById('new-ex-name').value = '';
        document.getElementById('new-ex-notes').value = '';
        this.tempNewExMuscles = [];
        this.renderNewExMuscles();
        
        document.getElementById('new-ex-title').innerText = "Nuovo Esercizio";
        document.getElementById('btn-save-exercise').innerText = "+ Aggiungi in Archivio";
        document.getElementById('btn-cancel-edit').style.display = "none";
    },
    updateLibraryEx(id, field, value) {
        const ex = this.state.library.find(e => e.id === id);
        if(!ex) return;
        if(field === 'name') {
            if(this.state.library.some(e => e.id !== id && e.name.toLowerCase() === value.trim().toLowerCase())) {
                alert("Nome già in uso."); return this.renderLibrary();
            }
        }
        ex[field] = value;
        if(field === 'name') this.sortLibraryAndRoutines();
        this.saveToStorage(); this.renderLibrary(); this.renderRoutineBuilder();
    },
    updateLibraryNotesFromActive(exId, value) {
        const ex = this.state.library.find(e => e.id === exId);
        if(ex) { ex.notes = value; this.saveToStorage(); }
    },
    deleteLibraryEx(id) {
        if(confirm("Eliminare questo esercizio? Verrà mostrato come 'Rimosso' nelle vecchie schede.")){
            this.state.library = this.state.library.filter(e => e.id !== id);
            this.saveToStorage(); this.renderLibrary(); this.renderRoutineBuilder();
        }
    },
    renderLibrary() {
        const container = document.getElementById('exercise-library-list');
        let html = '';
        this.state.library.forEach(ex => {
            html += `<div class="card" style="padding:15px; margin-bottom:15px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <div style="font-weight:bold; width:70%">${ex.name}</div>
                    <div>
                        <button class="btn-icon" style="color:var(--warning-color); margin-right: 5px;" onclick="App.editLibraryEx('${ex.id}')">✏️</button>
                        <button class="btn-icon" style="color:var(--danger-color)" onclick="App.deleteLibraryEx('${ex.id}')">🗑</button>
                    </div>
                </div>
                <div style="font-size:0.85rem; color:var(--text-muted);">${ex.notes || 'Nessuna nota'}</div>
            </div>`;
        });
        container.innerHTML = html;
    },

    // --- BUILDER SCHEDE ---
    createRoutine() {
        const name = document.getElementById('routine-name-input').value.trim();
        if(!name) return alert("Dai un nome alla scheda.");
        if(this.state.routines.some(r => r.name.toLowerCase() === name.toLowerCase())) return alert("Nome esiste già!");
        this.state.routines.push({ id: Logic.generateId('rt'), name, exercises: [] });
        this.sortLibraryAndRoutines(); this.saveToStorage();
        document.getElementById('routine-name-input').value = '';
        this.renderRoutineBuilder();
    },
    updateRoutineName(id, value) {
        const r = this.state.routines.find(x => x.id === id);
        if(!r) return;
        if(this.state.routines.some(x => x.id !== id && x.name.toLowerCase() === value.trim().toLowerCase())) {
            alert("Nome già in uso."); return this.renderRoutineBuilder();
        }
        r.name = value.trim();
        this.sortLibraryAndRoutines(); this.saveToStorage(); this.renderRoutineBuilder();
    },
    deleteRoutine(id) {
        if(confirm("Eliminare scheda?")) {
            this.state.routines = this.state.routines.filter(r => r.id !== id);
            this.saveToStorage(); this.renderRoutineBuilder();
        }
    },
    addExToRoutine(routineId, exId, setsCount) {
        const r = this.state.routines.find(x => x.id === routineId);
        if(r && exId) {
            r.exercises.push({ exerciseId: exId, setsCount: parseInt(setsCount) || 1 });
            this.saveToStorage(); this.renderRoutineBuilder();
        }
    },
    removeExFromRoutine(rId, index) {
        const r = this.state.routines.find(x => x.id === rId);
        r.exercises.splice(index, 1);
        this.saveToStorage(); this.renderRoutineBuilder();
    },
    moveExInRoutine(rId, index, dir) {
        const r = this.state.routines.find(x => x.id === rId);
        if(dir === -1 && index > 0) {
            [r.exercises[index-1], r.exercises[index]] = [r.exercises[index], r.exercises[index-1]];
        } else if (dir === 1 && index < r.exercises.length - 1) {
            [r.exercises[index+1], r.exercises[index]] = [r.exercises[index], r.exercises[index+1]];
        }
        this.saveToStorage(); this.renderRoutineBuilder();
    },
    updateExSetsInRoutine(rId, index, newSets) {
        const r = this.state.routines.find(x => x.id === rId);
        let val = parseInt(newSets);
        if(val > 0) { r.exercises[index].setsCount = val; this.saveToStorage(); }
    },
    renderRoutineBuilder() {
        const container = document.getElementById('routines-list');
        let html = '';
        const exOptions = this.state.library.map(e => `<option value="${e.id}">${e.name}</option>`).join('');

        this.state.routines.forEach(r => {
            html += `<div class="card" style="margin-bottom:20px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                    <input type="text" value="${r.name}" onchange="App.updateRoutineName('${r.id}', this.value)" style="font-weight:bold; font-size:1.1rem; margin:0; width:80%">
                    <button class="btn-icon" style="color:var(--danger-color);" onclick="App.deleteRoutine('${r.id}')">🗑</button>
                </div>
                <div style="margin-bottom:15px;">`;
            
            r.exercises.forEach((re, idx) => {
                const exData = this.state.library.find(e => e.id === re.exerciseId);
                const name = exData ? exData.name : "Esercizio rimosso";
                html += `<div style="display:flex; align-items:center; justify-content:space-between; font-size:0.9rem; padding:10px 0; border-bottom:1px solid var(--glass-border);">
                    <div style="flex:2; font-weight:600;">${idx+1}. ${name}</div>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <input type="number" value="${re.setsCount}" min="1" onchange="App.updateExSetsInRoutine('${r.id}', ${idx}, this.value)" style="width:50px; padding:8px; margin:0; text-align:center;">
                        <span style="color:var(--text-muted); font-size:0.8rem;">serie</span>
                    </div>
                    <div style="display:flex; gap:2px; margin-left:10px;">
                        <button class="btn-icon" onclick="App.moveExInRoutine('${r.id}', ${idx}, -1)">⬆️</button>
                        <button class="btn-icon" onclick="App.moveExInRoutine('${r.id}', ${idx}, 1)">⬇️</button>
                        <button class="btn-icon" style="color:var(--danger-color);" onclick="App.removeExFromRoutine('${r.id}', ${idx})">❌</button>
                    </div>
                </div>`;
            });

            html += `</div>
                <div class="input-row" style="margin-top:10px;">
                    <select id="sel-ex-${r.id}" style="flex:2; margin:0;"><option disabled selected>Esercizio...</option>${exOptions}</select>
                    <input type="number" id="sel-set-${r.id}" value="3" min="1" style="flex:1; margin:0;" placeholder="Serie">
                    <button class="btn btn-primary btn-small" style="margin:0;" onclick="App.addExToRoutine('${r.id}', document.getElementById('sel-ex-${r.id}').value, document.getElementById('sel-set-${r.id}').value)">+ Add</button>
                </div>
                <div id="routine-svg-${r.id}" style="margin-top:15px; padding-top:15px; border-top:1px solid var(--glass-border);"></div>
            </div>`;
        });
        container.innerHTML = html;
        
        // Renderizza l'SVG per ogni scheda
        this.state.routines.forEach(r => {
            const routineMuscles = new Set();
            r.exercises.forEach(re => {
                const ex = this.state.library.find(e => e.id === re.exerciseId);
                if(ex && ex.muscles) {
                    ex.muscles.forEach(m => routineMuscles.add(m));
                }
            });
            this.renderSVG('routine-svg-' + r.id, Array.from(routineMuscles));
        });

        this.renderStartWorkoutSelect();
    },

    // --- ALLENAMENTO ATTIVO (Sessione) ---
    renderStartWorkoutSelect() {
        const sel = document.getElementById('select-routine-to-start');
        sel.innerHTML = `<option value="" disabled selected>-- Seleziona una Scheda --</option>` +
            this.state.routines.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    },
    startWorkout() {
        if(this.state.activeWorkout) return alert("Hai già un allenamento in corso!");
        const rId = document.getElementById('select-routine-to-start').value;
        const routine = this.state.routines.find(r => r.id === rId);
        if(!routine) return alert("Seleziona una scheda!");

        const activeExs = routine.exercises.map(re => {
            const sets = [];
            for(let i=0; i<re.setsCount; i++) sets.push({ id: Logic.generateId('s'), kg: '', reps: '' });
            return { exId: re.exerciseId, sets: sets, sessionNote: '' };
        });

        this.state.activeWorkout = {
            id: Logic.generateId('w'),
            date: new Date().toISOString().split('T')[0],
            routineId: routine.id,
            routineName: routine.name,
            globalStartTime: Date.now(),
            exercises: activeExs,
            waterLiters: 0
        };
        
        document.getElementById('active-water-input').value = '';
        this.saveToStorage(); this.renderWorkoutView(); App.timers.stopRest();
    },
    endActiveWorkout() {
        if(!confirm("Terminare l'allenamento?")) return;

        // Controllo se ci sono modifiche rispetto alla scheda originale
        const originalRoutine = this.state.routines.find(r => r.id === this.state.activeWorkout.routineId);
        let routineModified = false;
        
        if (originalRoutine) {
            const activeExs = this.state.activeWorkout.exercises;
            const origExs = originalRoutine.exercises;
            
            if (activeExs.length !== origExs.length) {
                routineModified = true;
            } else {
                for (let i = 0; i < activeExs.length; i++) {
                    if (activeExs[i].exId !== origExs[i].exerciseId || activeExs[i].sets.length !== origExs[i].setsCount) {
                        routineModified = true;
                        break;
                    }
                }
            }
            
            if (routineModified && confirm("Hai apportato modifiche agli esercizi o alle serie rispetto alla scheda originale.\nVuoi aggiornare la scheda in modo permanente con queste modifiche?")) {
                originalRoutine.exercises = this.state.activeWorkout.exercises.map(activeEx => {
                    return {
                        exerciseId: activeEx.exId,
                        setsCount: activeEx.sets.length || 1
                    };
                });
            }
        }

        const elapsed = Date.now() - this.state.activeWorkout.globalStartTime;
        this.state.activeWorkout.globalDurationStr = Logic.formatTime(elapsed, true);
        
        const waterInput = document.getElementById('active-water-input').value;
        this.state.activeWorkout.waterLiters = waterInput ? parseFloat(waterInput) : 0;

        this.state.history.unshift(this.state.activeWorkout);
        this.state.activeWorkout = null;
        this.timers.stopRest();
        this.saveToStorage(); this.renderWorkoutView();
    },
    
    // Ricerca testuale degli Esercizi Attivi
    filterActiveExercises(query) {
        const resContainer = document.getElementById('active-search-results');
        if(!query.trim()) { resContainer.style.display = 'none'; resContainer.innerHTML = ''; return; }
        
        const q = query.toLowerCase();
        const filtered = this.state.library.filter(e => e.name.toLowerCase().includes(q));
        
        resContainer.style.display = 'block';
        if(filtered.length === 0) {
            resContainer.innerHTML = '<div style="padding:12px; color:var(--text-muted)">Nessun esercizio.</div>';
            return;
        }
        
        let html = '';
        filtered.forEach(ex => { html += `<div class="search-item" onclick="App.addExerciseToActive('${ex.id}')">${ex.name}</div>`; });
        resContainer.innerHTML = html;
    },
    addExerciseToActive(exId) {
        if(exId) {
            this.state.activeWorkout.exercises.push({ exId: exId, sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }], sessionNote: '' });
            this.saveToStorage(); this.renderActiveWorkout();
            document.getElementById('active-search-ex').value = '';
            document.getElementById('active-search-results').style.display = 'none';
        }
    },
    createExerciseFromActive() {
        const nameInput = document.getElementById('active-new-ex-name');
        const name = nameInput.value.trim();
        if(!name) return alert("Inserisci un nome.");
        if(this.state.library.some(e => e.name.toLowerCase() === name.toLowerCase())) return alert("Esercizio già esistente!");

        const newId = Logic.generateId('ex');
        this.state.library.push({ id: newId, name, notes: '', muscles: [] });
        this.sortLibraryAndRoutines();
        this.saveToStorage();
        
        nameInput.value = '';
        this.toggleUI('active-create-ex-box');
        
        // Lo aggiungo subito all'allenamento attivo
        this.addExerciseToActive(newId);
    },
    
    updateActiveSet(exIndex, setId, field, value) {
        const s = this.state.activeWorkout.exercises[exIndex].sets.find(x => x.id === setId);
        if(s) { s[field] = value; this.saveToStorage(); } 
    },
    removeActiveSet(exIndex, sIndex) {
        if(confirm("Vuoi eliminare questa serie?")) {
            this.state.activeWorkout.exercises[exIndex].sets.splice(sIndex, 1);
            this.saveToStorage(); this.renderActiveWorkout();
        }
    },
    removeActiveExercise(exIndex) {
        if(confirm("Vuoi rimuovere l'intero esercizio dalla sessione corrente?")) {
            this.state.activeWorkout.exercises.splice(exIndex, 1);
            this.saveToStorage(); this.renderActiveWorkout();
        }
    },
    addSpecialSet(exIndex, setId, type) {
        const s = this.state.activeWorkout.exercises[exIndex].sets.find(x => x.id === setId);
        if(s) {
            if(type === 'dropset') {
                if(!s.dropsets) s.dropsets = [];
                s.dropsets.push({ id: Logic.generateId('ds'), kg: '', reps: '' });
            } else if(type === 'isometry') {
                if(!s.isometrics) s.isometrics = [];
                s.isometrics.push({ id: Logic.generateId('iso'), kg: '', time: '' });
            }
            this.toggleUI(`special-menu-${setId}`);
            this.saveToStorage(); this.renderActiveWorkout();
        }
    },
    updateSpecialSet(exIndex, setId, typeArray, specialIdx, field, value) {
        const s = this.state.activeWorkout.exercises[exIndex].sets.find(x => x.id === setId);
        if(s && s[typeArray] && s[typeArray][specialIdx]) {
            s[typeArray][specialIdx][field] = value;
            this.saveToStorage();
        }
    },
    removeSpecialSet(exIndex, setId, typeArray, specialIdx) {
        const s = this.state.activeWorkout.exercises[exIndex].sets.find(x => x.id === setId);
        if(s && s[typeArray]) {
            s[typeArray].splice(specialIdx, 1);
            this.saveToStorage(); this.renderActiveWorkout();
        }
    },
    updateActiveSessionNote(exIndex, value) {
        if(this.state.activeWorkout.exercises[exIndex]) {
            this.state.activeWorkout.exercises[exIndex].sessionNote = value;
            this.saveToStorage();
        }
    },
    addSetToActiveEx(exIndex) {
        this.state.activeWorkout.exercises[exIndex].sets.push({ id: Logic.generateId('s'), kg: '', reps: '' });
        this.saveToStorage(); this.renderActiveWorkout();
    },

    renderWorkoutView() {
        const activeContainer = document.getElementById('active-workout-container');
        const startContainer = document.getElementById('start-workout-container');
        const topTimer = document.getElementById('top-timer-bar');

        if(this.state.activeWorkout) {
            activeContainer.style.display = 'block'; startContainer.style.display = 'none'; topTimer.style.display = 'flex';
            this.renderActiveWorkout();
        } else {
            activeContainer.style.display = 'none'; startContainer.style.display = 'block'; topTimer.style.display = 'none';
        }
        this.renderHistory();
    },

    renderActiveWorkout() {
        if(!this.state.activeWorkout) return;
        document.getElementById('active-routine-name').innerText = this.state.activeWorkout.routineName;

        const container = document.getElementById('active-exercises-list');
        let html = '';

        this.state.activeWorkout.exercises.forEach((exItem, exIndex) => {
            const libEx = this.state.library.find(l => l.id === exItem.exId);
            const exName = libEx ? libEx.name : "Esercizio Rimosso";
            const exNotes = libEx ? libEx.notes : "";

            const pastWorkouts = [];
            for(let w of this.state.history) {
                let ex = w.exercises.find(e => e.exId === exItem.exId);
                if(ex) pastWorkouts.push({ date: w.date, sets: ex.sets, note: ex.sessionNote });
                if(pastWorkouts.length === 2) break; 
            }
            
            let histHtml = '';
            if (pastWorkouts.length === 0) {
                histHtml = '<div style="font-size:0.8rem; color:var(--text-muted)">Nessun dato precedente trovato.</div>';
            } else {
                pastWorkouts.forEach(pw => {
                    histHtml += `<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px dashed var(--glass-border);">
                        <strong style="font-size:0.85rem; color:var(--primary-color)">${pw.date}</strong><br>`;
                    pw.sets.forEach((s, idx) => {
                        histHtml += `<span style="font-size:0.85rem; margin-right:15px; display:inline-block;">S${idx+1}: <b>${s.kg}</b> kg x <b>${s.reps}</b></span>`;
                    });
                    histHtml += `</div>`;
                });
            }

            let lastNote = pastWorkouts.find(p => p.note && p.note.trim() !== '')?.note || '';

            html += `<div style="margin-bottom:25px; padding-bottom:20px; border-bottom:1px solid rgba(255,255,255,0.1);">
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h4 style="color:var(--primary-color); margin:0;">${exName}</h4>
                    <div style="display:flex; gap:5px;">
                        <button class="btn-small" style="background:rgba(239, 68, 68, 0.1); border:1px solid var(--danger-color); color:var(--danger-color); border-radius:8px;" onclick="App.removeActiveExercise(${exIndex})">🗑</button>
                        <button class="btn-small" style="background:rgba(14, 165, 233, 0.1); border:1px solid var(--primary-color); color:var(--primary-color); border-radius:8px;" onclick="App.toggleUI('hist-${exItem.exId}-${exIndex}')">📊 Storico</button>
                        <button class="btn-small" style="background:rgba(255, 255, 255, 0.05); border:1px solid var(--glass-border); color:var(--text-muted); border-radius:8px;" onclick="App.toggleUI('setup-${exItem.exId}-${exIndex}')">📝 Setup</button>
                    </div>
                </div>

                <div id="hist-${exItem.exId}-${exIndex}" style="display:none; padding:12px; background:rgba(0,0,0,0.3); border-radius:8px; margin-bottom:15px; border:1px solid var(--glass-border);">
                    <h5 style="margin-bottom:8px;">Ultimi 2 Allenamenti:</h5>
                    ${histHtml}
                </div>
                
                <div id="setup-${exItem.exId}-${exIndex}" style="display:none; padding:12px; background:rgba(0,0,0,0.3); border-radius:8px; margin-bottom:15px; border:1px solid var(--glass-border);">
                    <h5 style="margin-bottom:8px; color:var(--text-muted)">Modifica Setup (Globale):</h5>
                    <input type="text" value="${exNotes}" placeholder="Note di setup (es. altezza sedile...)" onchange="App.updateLibraryNotesFromActive('${exItem.exId}', this.value)" style="margin:0;">
                </div>

                ${lastNote ? `<div style="background:rgba(239, 68, 68, 0.1); padding:10px; border-radius:8px; border-left:3px solid var(--danger-color); font-size:0.85rem; margin-bottom:15px; color:#fca5a5;">⚠️ <b>Note scorsa volta:</b> ${lastNote}</div>` : ''}
                `;
            
            exItem.sets.forEach((s, sIndex) => {
                let specialHtml = '';
                if(s.dropsets) {
                    s.dropsets.forEach((ds, dsIdx) => {
                        specialHtml += `<div class="set-row special-row" style="margin-left: 20px; border-left: 2px solid var(--warning-color); padding-left: 10px;">
                            <div style="font-size:0.75rem; color:var(--warning-color);">↳ Dropset</div>
                            <div class="set-controls">
                                <input type="number" step="0.25" placeholder="Kg" value="${ds.kg}" onchange="App.updateSpecialSet(${exIndex}, '${s.id}', 'dropsets', ${dsIdx}, 'kg', this.value)" style="margin:0">
                                <input type="number" placeholder="Reps" value="${ds.reps}" onchange="App.updateSpecialSet(${exIndex}, '${s.id}', 'dropsets', ${dsIdx}, 'reps', this.value)" style="margin:0">
                                <button class="btn-icon" style="color:var(--danger-color); padding:0 5px;" onclick="App.removeSpecialSet(${exIndex}, '${s.id}', 'dropsets', ${dsIdx})">×</button>
                            </div>
                        </div>`;
                    });
                }
                if(s.isometrics) {
                    s.isometrics.forEach((iso, isoIdx) => {
                        specialHtml += `<div class="set-row special-row" style="margin-left: 20px; border-left: 2px solid var(--accent-color); padding-left: 10px;">
                            <div style="font-size:0.75rem; color:var(--accent-color);">↳ Isometria</div>
                            <div class="set-controls">
                                <input type="number" step="0.25" placeholder="Kg" value="${iso.kg}" onchange="App.updateSpecialSet(${exIndex}, '${s.id}', 'isometrics', ${isoIdx}, 'kg', this.value)" style="margin:0">
                                <input type="number" placeholder="Sec" value="${iso.time}" onchange="App.updateSpecialSet(${exIndex}, '${s.id}', 'isometrics', ${isoIdx}, 'time', this.value)" style="margin:0">
                                <button class="btn-icon" style="color:var(--danger-color); padding:0 5px;" onclick="App.removeSpecialSet(${exIndex}, '${s.id}', 'isometrics', ${isoIdx})">×</button>
                            </div>
                        </div>`;
                    });
                }

                html += `
                <div class="set-row">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:0.8rem; font-weight:600; color:var(--text-main)">Serie ${sIndex + 1}</span>
                        <button class="btn-icon" style="color:var(--danger-color); font-size:1rem;" onclick="App.removeActiveSet(${exIndex}, ${sIndex})">🗑</button>
                    </div>
                    <div class="set-controls">
                        <input type="number" step="0.25" placeholder="Kg" value="${s.kg}" oninput="App.validateInput(this, 'float')" onchange="App.updateActiveSet(${exIndex}, '${s.id}', 'kg', this.value)" style="margin:0">
                        <input type="number" placeholder="Reps" value="${s.reps}" oninput="App.validateInput(this, 'int')" onchange="App.updateActiveSet(${exIndex}, '${s.id}', 'reps', this.value)" style="margin:0">
                        <button class="btn-icon" style="background:var(--primary-color); border-radius:50%; width:28px; height:28px; color:#fff;" onclick="App.toggleUI('special-menu-${s.id}')">+</button>
                    </div>
                </div>
                <div id="special-menu-${s.id}" style="display:none; text-align:right; margin-bottom:10px;">
                    <button class="btn-small" style="background:var(--warning-color); color:#fff; border:none; border-radius:4px; padding:4px 8px;" onclick="App.addSpecialSet(${exIndex}, '${s.id}', 'dropset')">Dropset</button>
                    <button class="btn-small" style="background:var(--accent-color); color:#fff; border:none; border-radius:4px; padding:4px 8px;" onclick="App.addSpecialSet(${exIndex}, '${s.id}', 'isometry')">Isometria</button>
                </div>
                ${specialHtml}`;
            });

            html += `<button class="btn btn-small" style="border:1px dashed var(--glass-border); background:rgba(255,255,255,0.05)" onclick="App.addSetToActiveEx(${exIndex})">+ Aggiungi Serie</button>
                <textarea placeholder="Note per la prossima volta (dolori, feedback)..." onchange="App.updateActiveSessionNote(${exIndex}, this.value)" style="width:100%; padding:12px; background:rgba(0,0,0,0.2); border:1px solid var(--glass-border); color:var(--text-main); border-radius:12px; margin-top:15px; font-size:0.9rem; resize:vertical;">${exItem.sessionNote || ''}</textarea>
            </div>`;
        });
        container.innerHTML = html;
    },

    // --- STORICO ALLENAMENTI ---
    updateHistory(wId, exIndex, setId, field, value) {
        const w = this.state.history.find(x => x.id === wId);
        if(w && w.exercises[exIndex]) {
            const s = w.exercises[exIndex].sets.find(x => x.id === setId);
            if(s) { s[field] = value; this.saveToStorage(); }
        }
    },
    updateHistoryGlobalTime(wId, val) {
        const w = this.state.history.find(x => x.id === wId);
        if(w) { w.globalDurationStr = val; this.saveToStorage(); }
    },
    deleteHistoryRecord(wId) {
        if(confirm("Eliminare definitivamente questo allenamento dallo storico?")) {
            this.state.history = this.state.history.filter(x => x.id !== wId);
            this.saveToStorage(); this.renderHistory();
        }
    },
    renderHistory() {
        const container = document.getElementById('history-container');
        if(this.state.history.length === 0) { container.innerHTML = "<p>Nessun allenamento salvato.</p>"; return; }

        let html = '';
        this.state.history.forEach(w => {
            html += `<div class="card" style="border-left: 4px solid var(--primary-dark);">
                <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                    <h3 style="margin:0; font-size:1.1rem">${w.date} - ${w.routineName}</h3>
                    <button class="btn-icon" style="color:var(--danger-color);" onclick="App.deleteHistoryRecord('${w.id}')">🗑</button>
                </div>
                <div style="margin-bottom:15px; font-size:0.9rem; color:var(--text-muted)">
                    Durata: <input type="text" value="${w.globalDurationStr}" onchange="App.updateHistoryGlobalTime('${w.id}', this.value)" style="width:100px; padding:6px; margin:0; display:inline-block">
                    ${w.waterLiters ? `<span style="margin-left: 15px; color:var(--primary-color);">💧 Acqua: ${w.waterLiters}L</span>` : ''}
                </div>`;
            
            w.exercises.forEach((ex, exIdx) => {
                const libEx = this.state.library.find(l => l.id === ex.exId);
                const name = libEx ? libEx.name : "Esercizio rimosso";
                html += `<div style="margin-bottom:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid var(--glass-border)">
                    <div style="font-weight:600; color:var(--primary-color); margin-bottom:8px;">${name}</div>`;
                
                ex.sets.forEach((s, sIdx) => {
                    html += `<div style="display:flex; gap:8px; margin-bottom:5px; align-items:center;">
                        <span style="width:30px; font-size:0.8rem; color:var(--text-muted); font-weight:600">S${sIdx+1}</span>
                        <input type="number" step="0.25" value="${s.kg}" style="padding:8px; margin:0; flex:1;" onchange="App.updateHistory('${w.id}', ${exIdx}, '${s.id}', 'kg', this.value)"> <span style="font-size:0.8rem">kg</span>
                        <input type="number" value="${s.reps}" style="padding:8px; margin:0; flex:1;" onchange="App.updateHistory('${w.id}', ${exIdx}, '${s.id}', 'reps', this.value)"> <span style="font-size:0.8rem">reps</span>
                    </div>`;
                });
                html += `</div>`;
            });
            html += `</div>`;
        });
        container.innerHTML = html;
    },

    // --- NUTRIZIONE ---
    saveProfile() {
        this.state.profile.dob = document.getElementById('profile-dob').value;
        this.state.profile.height = document.getElementById('profile-height').value;
        this.state.profile.gender = document.getElementById('profile-gender').value;
        this.saveToStorage(); this.renderNutritionDisplay(); 
    },
    
    loadNutritionDate(dateStr) {
        if (!dateStr) return;
        const data = this.state.nutrition[dateStr] || { weight: '', kcal: '', carbs: '', pro: '', fat: '' };
        document.getElementById('nutri-weight').value = data.weight;
        document.getElementById('nutri-kcal').value = data.kcal;
        document.getElementById('nutri-carbs').value = data.carbs;
        document.getElementById('nutri-pro').value = data.pro;
        document.getElementById('nutri-fat').value = data.fat;
        this.renderNutritionDisplay();
    },
    saveNutritionData() {
        const dateStr = document.getElementById('nutri-date').value;
        if(!dateStr) return;
        this.state.nutrition[dateStr] = {
            weight: document.getElementById('nutri-weight').value, kcal: document.getElementById('nutri-kcal').value,
            carbs: document.getElementById('nutri-carbs').value, pro: document.getElementById('nutri-pro').value, fat: document.getElementById('nutri-fat').value
        };
        this.saveToStorage(); this.renderNutritionDisplay();
    },
    updateNutritionHistory(dateStr, field, value) {
        if(this.state.nutrition[dateStr]) {
            this.state.nutrition[dateStr][field] = value;
            this.saveToStorage();
            if(dateStr === document.getElementById('nutri-date').value) document.getElementById('nutri-' + field).value = value;
            this.renderNutritionDisplay();
        }
    },
    deleteNutritionDay(dateStr) {
        if(confirm("Eliminare i dati di questo giorno?")) {
            delete this.state.nutrition[dateStr]; this.saveToStorage();
            if(dateStr === document.getElementById('nutri-date').value) this.loadNutritionDate(dateStr); 
            this.renderNutritionDisplay();
        }
    },

    renderNutritionDisplay() {
        const currentWeight = document.getElementById('nutri-weight').value;
        const bf = Logic.calculateBodyFat(currentWeight, this.state.profile);
        document.getElementById('current-bf-display').innerText = bf ? `${bf} %` : '-- %';

        const historyContainer = document.getElementById('nutrition-history-list');
        const sortedDates = Object.keys(this.state.nutrition).sort((a,b) => new Date(b) - new Date(a));
        let histHtml = '';
        
        if(sortedDates.length === 0) { histHtml = "<p>Nessun dato registrato.</p>"; } 
        else {
            sortedDates.forEach(d => {
                const day = this.state.nutrition[d];
                const dayBf = Logic.calculateBodyFat(day.weight, this.state.profile) || '--';
                histHtml += `<div class="card" style="padding:15px; margin-bottom:15px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <h4 style="margin:0; color:var(--primary-color)">${d}</h4>
                        <button class="btn-icon" style="color:var(--danger-color)" onclick="App.deleteNutritionDay('${d}')">🗑</button>
                    </div>
                    <div class="input-row" style="margin-bottom:10px;">
                        <input type="number" step="0.1" value="${day.weight}" onchange="App.updateNutritionHistory('${d}', 'weight', this.value)" style="padding:10px; margin:0;" placeholder="Kg"> <span style="font-size:0.8rem">kg</span>
                        <input type="number" value="${day.kcal}" onchange="App.updateNutritionHistory('${d}', 'kcal', this.value)" style="padding:10px; margin:0;" placeholder="Kcal"> <span style="font-size:0.8rem">kcal</span>
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-muted); display:flex; justify-content:space-between; background:rgba(0,0,0,0.2); padding:8px; border-radius:8px;">
                        <span>Macros: C ${day.carbs||0} | P ${day.pro||0} | F ${day.fat||0}</span><span style="font-weight:bold; color:var(--text-main)">BF: ${dayBf}%</span>
                    </div>
                </div>`;
            });
        }
        historyContainer.innerHTML = histHtml;
        
        // Passa l'array di oggetti nutrizione ordinato cronologicamente (dal più vecchio al più nuovo)
        const chronoData = sortedDates.reverse().map(d => ({ date: d, ...this.state.nutrition[d] }));
        this.renderTDEE(chronoData); 
    },
    
    renderTDEE(chronoData) {
        const resultBox = document.getElementById('tdee-result');
        const tdeeCalc = Logic.calculateTDEE(chronoData);
        
        if (tdeeCalc.error) { 
            resultBox.innerHTML = `<h3>-- kcal</h3><span>${tdeeCalc.message}</span>`; 
            return; 
        }

        resultBox.innerHTML = `<h3 style="font-size:2rem; color:var(--success-color); margin-bottom:5px;">${tdeeCalc.tdee} kcal</h3>
            <span style="font-weight:600">TDEE Stimato</span>
            <div style="margin-top:15px; font-size:0.85rem; color:var(--text-muted); background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; text-align:left;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span>Media Kcal (${tdeeCalc.daysTracked}gg):</span> 
                    <strong style="color:var(--text-main)">${tdeeCalc.avgKcal}</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>Trend Peso (${tdeeCalc.timeSpanDays}gg):</span> 
                    <strong style="color:${tdeeCalc.weightDiff > 0 ? 'var(--danger-color)' : 'var(--success-color)'}">${tdeeCalc.weightDiff > 0 ? '+'+tdeeCalc.weightDiff : tdeeCalc.weightDiff} kg</strong>
                </div>
            </div>`;
    },

    renderHomeDashboard() {
        const todayStr = new Date().toISOString().split('T')[0];
        
        // --- 1. Workout Status ---
        let workoutToday = this.state.history.find(w => {
            const date = new Date(w.globalStartTime || Date.now());
            // adjust timezone offset to get local YYYY-MM-DD
            const localStr = new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            return localStr === todayStr;
        });

        const iconEl = document.getElementById('home-workout-icon');
        const titleEl = document.getElementById('home-workout-title');
        const subEl = document.getElementById('home-workout-subtitle');
        const widgetEl = document.getElementById('home-workout-widget');

        if (this.state.activeWorkout) {
            iconEl.innerText = "⏳";
            titleEl.innerText = "In Corso";
            subEl.innerText = this.state.activeWorkout.routineName || "Allenamento attivo";
            widgetEl.style.borderLeftColor = "var(--warning-color)";
        } else if (workoutToday) {
            iconEl.innerText = "✅";
            titleEl.innerText = "Completato";
            subEl.innerText = workoutToday.routineName || "Allenamento terminato";
            widgetEl.style.borderLeftColor = "var(--success-color)";
        } else {
            iconEl.innerText = "😴";
            titleEl.innerText = "Riposo";
            subEl.innerText = "Nessun allenamento oggi.";
            widgetEl.style.borderLeftColor = "var(--primary-color)";
        }

        // --- 2. Nutrition ---
        const calc = Logic.calculateTDEEAndMacros(this.state);
        const tdee = calc.tdee || 2500;
        document.getElementById('home-kcal-target').innerText = tdee;
        
        const nut = this.state.nutrition[todayStr];
        const kcal = nut && nut.kcal ? parseFloat(nut.kcal) : 0;
        const carbs = nut && nut.carbs ? nut.carbs : 0;
        const pro = nut && nut.pro ? nut.pro : 0;
        const fat = nut && nut.fat ? nut.fat : 0;

        document.getElementById('home-kcal-eaten').innerText = kcal;
        document.getElementById('home-carbs-val').innerText = carbs + "g";
        document.getElementById('home-pro-val').innerText = pro + "g";
        document.getElementById('home-fat-val').innerText = fat + "g";
        
        const pct = Math.min(100, Math.max(0, (kcal / tdee) * 100));
        document.getElementById('home-kcal-bar').style.width = pct + "%";

        // --- 3. Body Fat & Streak ---
        document.getElementById('home-bf-display').innerText = calc.bf ? calc.bf.toFixed(1) + "%" : "--%";
        document.getElementById('home-streak-display').innerText = "🔥 " + this.state.history.length;

        // --- 4. Chart.js ---
        if(typeof Chart === 'undefined') return;

        const sortedDates = Object.keys(this.state.nutrition).sort((a,b) => new Date(a) - new Date(b));
        const weightDates = sortedDates.filter(d => this.state.nutrition[d].weight).slice(-14);
        const labels = weightDates.map(d => d.slice(5)); // MM-DD
        const data = weightDates.map(d => parseFloat(this.state.nutrition[d].weight));

        const canvas = document.getElementById('weightChart');
        if(!canvas) return;

        if (window.weightChartInstance) {
            window.weightChartInstance.destroy();
        }

        const ctx = canvas.getContext('2d');
        window.weightChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Peso (kg)',
                    data: data,
                    borderColor: '#3b82f6',
                    tension: 0.3,
                    fill: true,
                    backgroundColor: 'rgba(59, 130, 246, 0.2)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { 
                    x: { ticks: { color: 'rgba(255,255,255,0.7)' } },
                    y: { ticks: { color: 'rgba(255,255,255,0.7)' } } 
                }
            }
        });
    },

    renderAll() {
        document.getElementById('profile-dob').value = this.state.profile.dob || '';
        document.getElementById('profile-height').value = this.state.profile.height || '';
        document.getElementById('profile-gender').value = this.state.profile.gender || 'M';

        this.renderLibrary(); this.renderRoutineBuilder(); this.renderWorkoutView();
        this.loadNutritionDate(document.getElementById('nutri-date').value);
        this.renderHomeDashboard();
    }
};

window.App = App; // Esponi globale per poter essere chiamato dall'HTML (onClick)
window.onload = () => App.init();



