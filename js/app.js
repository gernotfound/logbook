import { Logic } from './logic.js';
import { DB } from './db.js';
import { COMMON_FOODS } from './foods.js';
import { Exporter } from './export.js';
import { StorageManager } from './storage.js';
import { ChartsManager } from './charts.js';
import { auth, provider, signInWithPopup, onAuthStateChanged } from './firebase-config.js';
const App = {
    state: {
        profile: { dob: '', height: '', gender: '' },
        library: [],      
        routines: [],     
        activeWorkout: null, 
        history: [],      
        nutrition: {},
        customFoods: [],
        calendarYear: new Date().getFullYear(),
        calendarMonth: new Date().getMonth(),
        selectedHistoryDate: null,
        routineSearchQuery: '',
        nutritionPlanning: {
            weight: 80,
            carbsPerKg: 3.5,
            proPerKg: 2.0,
            fatPerKg: 1.0,
            lockedMacro: null,
            chartPeriod: 7,
            normocalorica: {
                kcal: 2500,
                carbs: 300,
                pro: 160,
                fat: 70
            }
        }
    },
    init() {
        onAuthStateChanged(auth, async (user) => {
            const authOverlay = document.getElementById('auth-overlay');
            const mainApp = document.getElementById('app-container');
            if (user) {
                authOverlay.style.display = 'none';
                mainApp.style.display = 'block';
                await this.loadDataFromCloud();
                document.getElementById('nutri-date').value = new Date().toISOString().split('T')[0];
                this.timers.initLoop();
                this.renderAll();
                this.renderNewExMuscles(); // Assicura che l'SVG vuoto venga renderizzato all'avvio
            } else {
                authOverlay.style.display = 'flex';
                document.getElementById('auth-loading').style.display = 'none';
                document.getElementById('auth-login-box').style.display = 'block';
                mainApp.style.display = 'none';
            }
        });
        document.getElementById('btn-login-google').addEventListener('click', () => {
            signInWithPopup(auth, provider).catch(error => {
                console.error("Errore di Login:", error);
                alert("Errore durante il login con Google.");
            });
        });
        document.getElementById('btn-logout').addEventListener('click', () => {
            if(confirm('Sei sicuro di voler effettuare il logout?')) {
                DB.secureLogOut();
            }
        });
        document.getElementById('btn-delete-account').addEventListener('click', () => {
            const answer = prompt('ATTENZIONE: Stai per eliminare per sempre tutti i tuoi dati e il tuo account.\nScrivi "elimina account" per confermare:');
            if(answer && answer.trim().toLowerCase() === "elimina account") {
                DB.deleteAccount();
            } else if (answer !== null) {
                alert("Testo non corrispondente. Operazione annullata.");
            }
        });
        document.getElementById('btn-export-csv').addEventListener('click', () => {
            if(confirm("Vuoi scaricare tutti i tuoi allenamenti e misurazioni in formato CSV?")) {
                Exporter.exportToCSV(App.state.history, App.state.nutrition);
            }
        });
    },
    async loadDataFromCloud() {
        const cloudData = await DB.loadUserData();
        if (cloudData) {
            this.state = Object.assign(this.state, cloudData);
            this.sortLibraryAndRoutines();
        } else {
            this.state.profile = { dob: '', height: '', gender: '' };
        }
    },
    showAppStatus() {
        const isOnline = navigator.onLine ? "Online 🟢" : "Offline 🔴";
        const version = "v3.2.3"; // Sincronizzato con sw.js
        alert(`Stato Applicazione\n\nVersione: ${version}\nStato Rete: ${isOnline}`);
    },
    saveTimeout: null,
    saveToStorage() { 
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
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
    toggleUI(id, btnElement) {
        const el = document.getElementById(id);
        if(el) {
            const isHidden = (el.style.display === 'none' || getComputedStyle(el).display === 'none');
            el.style.display = isHidden ? 'block' : 'none';
            if (btnElement) {
                btnElement.classList.toggle('active', isHidden);
            }
        } else if (btnElement) {
            btnElement.classList.toggle('active');
        }
    },
    sortLibraryAndRoutines() {
        this.state.library.sort((a, b) => a.name.localeCompare(b.name));
        this.state.routines.sort((a, b) => a.name.localeCompare(b.name));
    },
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
        document.querySelectorAll('#view-training .sub-nav .sub-nav-btn').forEach(el => el.classList.remove('active'));
        const targetSub = document.getElementById('sub-' + subTab);
        if (targetSub) targetSub.classList.add('active');
        if (btnElement) btnElement.classList.add('active');
        if (subTab === 'history') {
            this.renderHistory();
        } else if (subTab === 'session') {
            this.renderWorkoutView();
        } else if (subTab === 'routines') {
            this.renderRoutineBuilder();
        } else if (subTab === 'exercises') {
            this.renderLibrary();
        }
    },
    switchNutritionTab(subTab, btnElement) {
        document.querySelectorAll('.nutrition-sub-view').forEach(el => el.classList.remove('active'));
        const navBtns = document.querySelectorAll('#view-nutrition .sub-nav .sub-nav-btn');
        navBtns.forEach(el => el.classList.remove('active'));
        const targetSub = document.getElementById('sub-nutri-' + subTab);
        if (targetSub) targetSub.classList.add('active');
        if (btnElement) btnElement.classList.add('active');
        if (subTab === 'planning') {
            this.renderNutritionPlanning();
        }
        if (subTab === 'measurements') {
            this.renderMeasurements();
        }
    },
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
            let svgIds = Logic.GROUP_MAP[mId] || [mId];
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
    renderStartWorkoutSelect() {
        const sel = document.getElementById('select-routine-to-start');
        if (sel) {
            sel.innerHTML = `<option value="" disabled selected>-- Seleziona una Scheda --</option>` +
                this.state.routines.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
        }
    },
    startWorkout(routineId) {
        if(this.state.activeWorkout) return alert("Hai già un allenamento in corso!");
        const rId = routineId || (document.getElementById('select-routine-to-start') ? document.getElementById('select-routine-to-start').value : '');
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
            waterLiters: 0,
            moodRating: null,
            pumpRating: null,
            fatigueRating: null
        };
        const moodInput = document.getElementById('active-mood-input');
        const pumpInput = document.getElementById('active-pump-input');
        const fatigueInput = document.getElementById('active-fatigue-input');
        if (moodInput) moodInput.value = '';
        if (pumpInput) pumpInput.value = '';
        if (fatigueInput) fatigueInput.value = '';
        const waterInput = document.getElementById('active-water-input');
        if (waterInput) waterInput.value = '';
        this.saveToStorage(); this.renderWorkoutView(); App.timers.stopRest();
    },
    endActiveWorkout() {
        const moodVal = document.getElementById('active-mood-input')?.value;
        const pumpVal = document.getElementById('active-pump-input')?.value;
        const fatigueVal = document.getElementById('active-fatigue-input')?.value;
        const valRes = Logic.validateWorkoutRatings(moodVal, pumpVal, fatigueVal);
        if (!valRes.isValid) {
            alert("Inserisci voti validi (interi da 1 a 10) per Umore, Pump e Stanchezza prima di terminare la sessione.");
            return;
        }
        if(!confirm("Terminare l'allenamento?")) return;
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
        this.state.activeWorkout.moodRating = valRes.mood;
        this.state.activeWorkout.pumpRating = valRes.pump;
        this.state.activeWorkout.fatigueRating = valRes.fatigue;
        this.state.history.unshift(this.state.activeWorkout);
        this.state.activeWorkout = null;
        this.timers.stopRest();
        this.saveToStorage(); this.renderWorkoutView();
    },
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
            if (activeContainer) activeContainer.style.display = 'block';
            if (startContainer) startContainer.style.display = 'none';
            if (topTimer) topTimer.style.display = 'flex';
            this.renderActiveWorkout();
        } else {
            if (activeContainer) activeContainer.style.display = 'none';
            if (startContainer) startContainer.style.display = 'block';
            if (topTimer) topTimer.style.display = 'none';
            this.renderRoutinesList();
            this.renderStartWorkoutSelect();
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
                    <h3 style="color:var(--primary-color); margin:0;">${exName}</h3>
                    <div style="display:flex; gap:5px;">
                        <button class="btn-small" style="background:rgba(239, 68, 68, 0.1); border:1px solid var(--danger-color); color:var(--danger-color); border-radius:8px;" onclick="App.removeActiveExercise(${exIndex})">🗑</button>
                        <button class="btn-small toggle-btn" onclick="App.toggleUI('hist-${exItem.exId}-${exIndex}', this)">📊 Storico</button>
                        <button class="btn-small toggle-btn" onclick="App.toggleUI('setup-${exItem.exId}-${exIndex}', this)">📝 Setup</button>
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
    onRoutineSearchInput(query) {
        this.state.routineSearchQuery = query || '';
        this.renderRoutinesList();
    },
    renderRoutinesList() {
        const container = document.getElementById('routine-cards-container');
        if (!container) return;
        const filtered = Logic.filterRoutines(this.state.routines, this.state.library, this.state.routineSearchQuery);
        if (filtered.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:15px;">Nessuna scheda trovata.</p>`;
            return;
        }
        let html = '';
        filtered.forEach(r => {
            const exSummaryList = (r.exercises || []).map(re => {
                const ex = this.state.library.find(l => l.id === (re.exerciseId || re.id));
                return ex ? `${ex.name} (${re.setsCount} serie)` : null;
            }).filter(Boolean);
            const exSummary = exSummaryList.length > 0 ? exSummaryList.join(' • ') : 'Nessun esercizio';
            html += `<div class="routine-card">
                <div class="routine-card-header">
                    <h3 class="routine-card-title" style="margin:0;">${r.name}</h3>
                </div>
                ${r.description ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:6px;">${r.description}</div>` : ''}
                <div class="routine-card-ex-list">${exSummary}</div>
                <div id="start-routine-svg-${r.id}" class="muscle-svg-map"></div>
                <button class="btn btn-primary" style="width:100%; margin-top:10px; margin-bottom:0;" onclick="App.startWorkout('${r.id}')">▶️ Inizia ${r.name}</button>
            </div>`;
        });
        container.innerHTML = html;
        filtered.forEach(r => {
            const routineMuscles = new Set();
            (r.exercises || []).forEach(re => {
                const ex = this.state.library.find(l => l.id === (re.exerciseId || re.id));
                if (ex && Array.isArray(ex.muscles)) {
                    ex.muscles.forEach(m => routineMuscles.add(m));
                }
            });
            this.renderSVG('start-routine-svg-' + r.id, Array.from(routineMuscles));
        });
    },
    renderCalendar() {
        const gridContainer = document.getElementById('calendar-grid');
        const titleEl = document.getElementById('calendar-month-year-title');
        const infoEl = document.getElementById('calendar-selected-info');
        const resetBtn = document.getElementById('btn-reset-calendar-filter');
        if (!gridContainer) return;
        const monthNames = [
            'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
            'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
        ];
        if (titleEl) {
            titleEl.textContent = `${monthNames[this.state.calendarMonth]} ${this.state.calendarYear}`;
        }
        const grid = Logic.getCalendarMonthGrid(this.state.calendarYear, this.state.calendarMonth);
        const workoutDatesSet = Logic.getWorkoutDatesSet(this.state.history);
        let gridHtml = '';
        grid.forEach(cell => {
            let classes = ['calendar-day-cell'];
            if (!cell.isCurrentMonth) classes.push('other-month');
            if (cell.isToday) classes.push('today');
            if (cell.dateStr === this.state.selectedHistoryDate) classes.push('selected');
            const hasWorkout = workoutDatesSet.has(cell.dateStr);
            const dotHtml = hasWorkout ? '<div class="workout-dot"></div>' : '';
            gridHtml += `<div class="${classes.join(' ')}" onclick="App.selectCalendarDate('${cell.dateStr}')">
                <span>${cell.dayNum}</span>
                ${dotHtml}
            </div>`;
        });
        gridContainer.innerHTML = gridHtml;
        if (infoEl && resetBtn) {
            if (this.state.selectedHistoryDate) {
                infoEl.textContent = `Filtrato: ${this.state.selectedHistoryDate}`;
                resetBtn.style.display = 'inline-block';
            } else {
                infoEl.textContent = 'Tutti gli allenamenti';
                resetBtn.style.display = 'none';
            }
        }
    },
    changeCalendarMonth(delta) {
        this.state.calendarMonth += delta;
        if (this.state.calendarMonth < 0) {
            this.state.calendarMonth = 11;
            this.state.calendarYear--;
        } else if (this.state.calendarMonth > 11) {
            this.state.calendarMonth = 0;
            this.state.calendarYear++;
        }
        this.renderCalendar();
    },
    selectCalendarDate(dateStr) {
        if (this.state.selectedHistoryDate === dateStr) {
            this.state.selectedHistoryDate = null;
        } else {
            this.state.selectedHistoryDate = dateStr;
        }
        this.renderHistory();
    },
    clearCalendarFilter() {
        this.state.selectedHistoryDate = null;
        this.renderHistory();
    },
    renderHistory() {
        this.renderCalendar();
        const container = document.getElementById('history-container');
        if (!container) return;
        ChartsManager.renderVolumeChart(this.state.history);
        if (this.state.history.length === 0) {
            container.innerHTML = "<p>Nessun allenamento salvato.</p>";
            return;
        }
        let historyItems = this.state.history;
        if (this.state.selectedHistoryDate) {
            historyItems = historyItems.filter(w => {
                const wDate = (w.date || '').split('T')[0];
                return wDate === this.state.selectedHistoryDate;
            });
        }
        if (historyItems.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);">Nessun allenamento per il ${this.state.selectedHistoryDate}.</p>`;
            return;
        }
        let html = '';
        historyItems.forEach(w => {
            const hasRatings = (w.moodRating !== undefined && w.moodRating !== null) ||
                               (w.pumpRating !== undefined && w.pumpRating !== null) ||
                               (w.fatigueRating !== undefined && w.fatigueRating !== null);
            const ratingsHtml = hasRatings ? `
                <div class="workout-ratings-badges">
                    ${w.moodRating ? `<span class="rating-badge mood">Umore: ${w.moodRating}/10</span>` : ''}
                    ${w.pumpRating ? `<span class="rating-badge pump">Pump: ${w.pumpRating}/10</span>` : ''}
                    ${w.fatigueRating ? `<span class="rating-badge fatigue">Stanchezza: ${w.fatigueRating}/10</span>` : ''}
                </div>
            ` : '';
            html += `<div class="card" style="border-left: 4px solid var(--primary-dark);">
                <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                    <h3 style="margin:0; font-size:1.1rem">${w.date} - ${w.routineName}</h3>
                    <button class="btn-icon" style="color:var(--danger-color);" onclick="App.deleteHistoryRecord('${w.id}')">🗑</button>
                </div>
                <div style="margin-bottom:15px; font-size:0.9rem; color:var(--text-muted)">
                    Durata: <input type="text" value="${w.globalDurationStr || ''}" onchange="App.updateHistoryGlobalTime('${w.id}', this.value)" style="width:100px; padding:6px; margin:0; display:inline-block">
                    ${w.waterLiters ? `<span style="margin-left: 15px; color:var(--primary-color);">💧 Acqua: ${w.waterLiters}L</span>` : ''}
                </div>
                ${ratingsHtml}`;
            (w.exercises || []).forEach((ex, exIdx) => {
                const libEx = this.state.library.find(l => l.id === ex.exId);
                const name = libEx ? libEx.name : "Esercizio rimosso";
                html += `<div style="margin-bottom:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid var(--glass-border)">
                    <div style="font-weight:600; color:var(--primary-color); margin-bottom:8px;">${name}</div>`;
                (ex.sets || []).forEach((s, sIdx) => {
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
    saveProfile() {
        this.state.profile.dob = document.getElementById('profile-dob').value;
        this.state.profile.height = document.getElementById('profile-height').value;
        this.state.profile.gender = document.getElementById('profile-gender').value;
        this.saveToStorage(); 
        this.updateMeasurementMethodOptions();
        this.renderNutritionDisplay(); 
    },
    loadNutritionDate(dateStr) {
        if (!dateStr) {
            dateStr = new Date().toISOString().split('T')[0];
        }
        const dateInput = document.getElementById('nutri-date');
        if (dateInput) dateInput.value = dateStr;
        if (!this.state.nutrition[dateStr]) {
            this.state.nutrition[dateStr] = {
                weight: '',
                bfPercentage: null,
                kcal: 0,
                carbs: 0,
                pro: 0,
                fat: 0,
                meals: [
                    { id: 'meal_colazione', name: 'Colazione', foods: [] },
                    { id: 'meal_pranzo', name: 'Pranzo', foods: [] },
                    { id: 'meal_cena', name: 'Cena', foods: [] },
                    { id: 'meal_spuntini', name: 'Spuntini', foods: [] }
                ]
            };
        } else {
            const data = this.state.nutrition[dateStr];
            if (!Array.isArray(data.meals) || data.meals.length === 0) {
                data.meals = [
                    { id: 'meal_colazione', name: 'Colazione', foods: [] },
                    { id: 'meal_pranzo', name: 'Pranzo', foods: [] },
                    { id: 'meal_cena', name: 'Cena', foods: [] },
                    { id: 'meal_spuntini', name: 'Spuntini', foods: [] }
                ];
            } else {
                const requiredMeals = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];
                requiredMeals.forEach(mName => {
                    let existing = data.meals.find(m => m.name === mName || m.id === 'meal_' + mName.toLowerCase());
                    if (!existing) {
                        data.meals.push({ id: 'meal_' + mName.toLowerCase(), name: mName, foods: [] });
                    }
                });
            }
        }
        const data = this.state.nutrition[dateStr];
        const weightInput = document.getElementById('nutri-weight');
        if (weightInput) weightInput.value = data.weight || '';
        this.renderNutritionDisplay();
    },
    navigateNutritionDate(offsetDays) {
        let dateInput = document.getElementById('nutri-date');
        let dateStr = dateInput ? dateInput.value : '';
        if (!dateStr || offsetDays === 0) {
            dateStr = new Date().toISOString().split('T')[0];
        } else {
            const parts = dateStr.split('-');
            const curr = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            curr.setDate(curr.getDate() + offsetDays);
            const year = curr.getFullYear();
            const month = String(curr.getMonth() + 1).padStart(2, '0');
            const day = String(curr.getDate()).padStart(2, '0');
            dateStr = `${year}-${month}-${day}`;
        }
        this.loadNutritionDate(dateStr);
    },
    saveNutritionWeight(weightVal) {
        const dateInput = document.getElementById('nutri-date');
        const dateStr = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        if (!this.state.nutrition[dateStr]) {
            this.loadNutritionDate(dateStr);
        }
        this.state.nutrition[dateStr].weight = weightVal;
        const bf = Logic.calculateBodyFat(weightVal, this.state.profile);
        this.state.nutrition[dateStr].bfPercentage = bf ? parseFloat(bf) : null;
        this.saveToStorage();
        this.renderNutritionDisplay();
    },

    updateNutritionHistory(dateStr, field, value) {
        if (this.state.nutrition[dateStr]) {
            this.state.nutrition[dateStr][field] = value;
            this.saveToStorage();
            if (dateStr === document.getElementById('nutri-date').value && field === 'weight') {
                const weightElem = document.getElementById('nutri-weight');
                if (weightElem) weightElem.value = value;
            }
            this.renderNutritionDisplay();
        }
    },
    deleteNutritionDay(dateStr) {
        if (confirm("Eliminare i dati di questo giorno?")) {
            delete this.state.nutrition[dateStr];
            this.saveToStorage();
            if (dateStr === document.getElementById('nutri-date').value) {
                this.loadNutritionDate(dateStr);
            } else {
                this.renderNutritionDisplay();
            }
        }
    },
    renderNutritionDisplay() {
        const dateInput = document.getElementById('nutri-date');
        const dateStr = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        const weightElem = document.getElementById('nutri-weight');
        const currentWeight = weightElem ? weightElem.value : (this.state.nutrition[dateStr]?.weight || '');
        const bf = Logic.calculateBodyFat(currentWeight, this.state.profile);
        const bfDisplay = document.getElementById('current-bf-display');
        if (bfDisplay) bfDisplay.innerText = bf ? `${bf} %` : '-- %';
        const dayData = this.state.nutrition[dateStr] || { meals: [] };
        const dayMeals = dayData.meals || [];
        const planning = this.state.nutritionPlanning;
        let targetPlan = planning || { normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 } };
        if (planning && planning.weight && planning.carbsPerKg !== undefined) {
            const calc = Logic.calculateMacrosFromKg(planning.weight, planning.carbsPerKg, planning.proPerKg, planning.fatPerKg);
            if (calc.totalKcal > 0) {
                targetPlan = {
                    normocalorica: {
                        kcal: calc.totalKcal,
                        carbs: calc.carbsGrams,
                        pro: calc.proGrams,
                        fat: calc.fatGrams
                    }
                };
            }
        }
        const summary = Logic.calculateDailyNutritionSummary(dayMeals, targetPlan);
        if (this.state.nutrition[dateStr]) {
            this.state.nutrition[dateStr].kcal = summary.totals.kcal;
            this.state.nutrition[dateStr].carbs = summary.totals.carbs;
            this.state.nutrition[dateStr].pro = summary.totals.pro;
            this.state.nutrition[dateStr].fat = summary.totals.fat;
        }
        const targetBadge = document.getElementById('daily-kcal-target-badge');
        if (targetBadge) targetBadge.innerText = `${summary.totals.kcal} / ${summary.targets.kcal} kcal`;
        const progressFill = document.getElementById('daily-kcal-progress');
        if (progressFill) {
            const pct = Math.min(100, summary.percentages.kcal);
            progressFill.style.width = `${pct}%`;
            if (summary.totals.kcal > summary.targets.kcal) {
                progressFill.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
            } else {
                progressFill.style.background = 'linear-gradient(90deg, var(--primary-color), var(--success-color))';
            }
        }
        const consumedText = document.getElementById('daily-kcal-consumed-text');
        if (consumedText) consumedText.innerText = `Consumate: ${summary.totals.kcal} kcal`;
        const remainingText = document.getElementById('daily-kcal-remaining-text');
        if (remainingText) {
            if (summary.remaining.kcal >= 0) {
                remainingText.innerText = `Rimanenti: ${summary.remaining.kcal} kcal`;
                remainingText.style.color = 'var(--text-muted)';
            } else {
                remainingText.innerText = `+${Math.abs(summary.remaining.kcal)} kcal oltre target`;
                remainingText.style.color = '#ef4444';
            }
        }
        const setMacroBar = (valId, targetId, barId, consumed, target, pct) => {
            const valElem = document.getElementById(valId);
            if (valElem) valElem.innerText = `${consumed}g`;
            const targetElem = document.getElementById(targetId);
            if (targetElem) targetElem.innerText = `/ ${target}g`;
            const barElem = document.getElementById(barId);
            if (barElem) barElem.style.width = `${Math.min(100, pct)}%`;
        };
        setMacroBar('daily-carbs-val', 'daily-carbs-target', 'daily-carbs-bar', summary.totals.carbs, summary.targets.carbs, summary.percentages.carbs);
        setMacroBar('daily-pro-val', 'daily-pro-target', 'daily-pro-bar', summary.totals.pro, summary.targets.pro, summary.percentages.pro);
        setMacroBar('daily-fat-val', 'daily-fat-target', 'daily-fat-bar', summary.totals.fat, summary.targets.fat, summary.percentages.fat);
        const mealCategories = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];
        mealCategories.forEach(mName => {
            const mKey = mName.toLowerCase();
            const mealObj = dayMeals.find(m => m.name === mName || m.id === 'meal_' + mKey) || { foods: [] };
            const foods = mealObj.foods || [];
            const mealTotals = Logic.calculateMealTotals([mealObj]);
            const subtotalElem = document.getElementById(`meal-subtotal-${mKey}`);
            if (subtotalElem) {
                subtotalElem.innerText = `${mealTotals.kcal} kcal • C:${mealTotals.carbs} P:${mealTotals.pro} F:${mealTotals.fat}`;
            }
            const itemsContainer = document.getElementById(`meal-items-${mKey}`);
            if (itemsContainer) {
                if (foods.length === 0) {
                    itemsContainer.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:0.8rem; font-style:italic;">Nessun alimento in ${mName}. Clicca + Aggiungi.</div>`;
                } else {
                    let html = '';
                    foods.forEach(item => {
                        html += `
                            <div class="logged-food-item">
                                <div class="logged-food-info">
                                    <div class="logged-food-name">${item.name} <span style="font-size:0.75rem; font-weight:normal; color:var(--primary-color);">(${item.qty} ${item.unit})</span></div>
                                    <div class="logged-food-macros">🔥 ${item.kcal} kcal | C: ${item.carbs}g | P: ${item.pro}g | F: ${item.fat}g</div>
                                </div>
                                <div class="logged-food-actions">
                                    <button class="chip-btn" onclick="App.openEditMealItemModal('${mName}', '${item.id}')" title="Modifica">✏️</button>
                                    <button class="chip-btn" style="color:#ef4444;" onclick="App.deleteMealItem('${mName}', '${item.id}')" title="Elimina">🗑</button>
                                </div>
                            </div>
                        `;
                    });
                    itemsContainer.innerHTML = html;
                }
            }
        });
        const historyContainer = document.getElementById('nutrition-history-list');
        if (historyContainer) {
            const sortedDates = Object.keys(this.state.nutrition).sort((a,b) => new Date(b) - new Date(a));
            let histHtml = '';
            if(sortedDates.length === 0) { histHtml = "<p>Nessun dato registrato.</p>"; } 
            else {
                sortedDates.forEach(d => {
                    const day = this.state.nutrition[d];
                    const dayBf = Logic.calculateBodyFat(day.weight, this.state.profile) || '--';
                    histHtml += `<div class="card" style="padding:15px; margin-bottom:15px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                            <h3 style="margin:0; color:var(--primary-color)">${d}</h3>
                            <button class="btn-icon" style="color:var(--danger-color)" onclick="App.deleteNutritionDay('${d}')">🗑</button>
                        </div>
                        <div class="input-row" style="margin-bottom:10px;">
                            <input type="number" step="0.1" value="${day.weight || ''}" onchange="App.updateNutritionHistory('${d}', 'weight', this.value)" style="padding:10px; margin:0;" placeholder="Kg"> <span style="font-size:0.8rem">kg</span>
                            <input type="number" value="${day.kcal || 0}" readonly style="padding:10px; margin:0; opacity:0.8;" placeholder="Kcal"> <span style="font-size:0.8rem">kcal</span>
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-muted); display:flex; justify-content:space-between; background:rgba(0,0,0,0.2); padding:8px; border-radius:8px;">
                            <span>Macros: C ${day.carbs||0} | P ${day.pro||0} | F ${day.fat||0}</span><span style="font-weight:bold; color:var(--text-main)">BF: ${dayBf}%</span>
                        </div>
                    </div>`;
                });
            }
            historyContainer.innerHTML = histHtml;
            const chronoData = sortedDates.slice().reverse().map(d => ({ date: d, ...this.state.nutrition[d] }));
            this.renderTDEE(chronoData);
        }
    },
    onFoodSearchInput(query) {
        const clearBtn = document.getElementById('btn-clear-food-search');
        const dropdown = document.getElementById('nutri-food-results');
        if (!query || !query.trim()) {
            if (clearBtn) clearBtn.style.display = 'none';
            if (dropdown) dropdown.style.display = 'none';
            return;
        }
        if (clearBtn) clearBtn.style.display = 'block';
        const customFoods = this.state.customFoods || [];
        const combined = [...COMMON_FOODS, ...customFoods];
        const results = Logic.searchFoods(combined, query);
        if (!dropdown) return;
        if (results.length === 0) {
            dropdown.innerHTML = `<div class="food-result-item" style="color:var(--text-muted); font-size:0.85rem;">Nessun alimento trovato per "${query}".</div>`;
        } else {
            let html = '';
            results.forEach(food => {
                const badge = food.isCustom ? '<span class="badge badge-warning" style="font-size:0.65rem; margin-left:6px;">Custom</span>' : '<span class="badge badge-primary" style="font-size:0.65rem; margin-left:6px;">Common</span>';
                const servingInfo = food.servingUnit ? `per ${food.servingUnit} (${food.servingWeight}${food.unit})` : `per 100 ${food.unit}`;
                html += `
                    <div class="food-result-item" onclick="App.selectSearchFood('${food.id}')">
                        <div>
                            <div style="font-weight:bold; font-size:0.9rem;">${food.name} ${badge}</div>
                            <div style="font-size:0.75rem; color:var(--text-muted);">${food.category || 'Alimento'} • ${servingInfo}</div>
                        </div>
                        <div style="font-weight:bold; font-size:0.85rem; color:var(--warning-color);">
                            ${food.kcal} kcal <span style="font-weight:normal; font-size:0.75rem; color:var(--text-muted);">(C:${food.carbs} P:${food.pro} F:${food.fat})</span>
                        </div>
                    </div>
                `;
            });
            dropdown.innerHTML = html;
        }
        dropdown.style.display = 'block';
    },
    clearFoodSearch() {
        const input = document.getElementById('nutri-food-search');
        if (input) input.value = '';
        const clearBtn = document.getElementById('btn-clear-food-search');
        if (clearBtn) clearBtn.style.display = 'none';
        const dropdown = document.getElementById('nutri-food-results');
        if (dropdown) dropdown.style.display = 'none';
    },
    focusMealSearch(mealName) {
        this._targetMealName = mealName;
        const searchInput = document.getElementById('nutri-food-search');
        if (searchInput) {
            searchInput.focus();
            searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },
    selectSearchFood(foodId) {
        const customFoods = this.state.customFoods || [];
        const combined = [...COMMON_FOODS, ...customFoods];
        const food = combined.find(f => f.id === foodId);
        if (food) {
            this.clearFoodSearch();
            this.openQtyModal(food, null, this._targetMealName);
        }
    },
    _activeQtyFood: null,
    _editingMealItem: null,
    _targetMealName: 'Colazione',
    openQtyModal(food, existingItem = null, targetMealName = null) {
        this._activeQtyFood = food;
        this._editingMealItem = existingItem;
        if (targetMealName) this._targetMealName = targetMealName;
        const modal = document.getElementById('modal-food-qty');
        if (!modal) return;
        document.getElementById('modal-food-title').innerText = food.name;
        const mealSelect = document.getElementById('modal-meal-select');
        if (mealSelect) mealSelect.value = targetMealName || this._targetMealName || 'Colazione';
        const unitSelect = document.getElementById('modal-food-unit-select');
        if (unitSelect) {
            let optionsHtml = `<option value="${food.unit}">${food.unit}</option>`;
            if (food.servingUnit) {
                optionsHtml += `<option value="${food.servingUnit}">${food.servingUnit} (${food.servingWeight}${food.unit})</option>`;
            }
            unitSelect.innerHTML = optionsHtml;
            unitSelect.value = existingItem ? existingItem.unit : (food.servingUnit || food.unit);
        }
        const qtyInput = document.getElementById('modal-food-qty-val');
        if (qtyInput) {
            if (existingItem) {
                qtyInput.value = existingItem.qty;
            } else {
                qtyInput.value = food.servingUnit ? 1 : (food.baseQty || 100);
            }
        }
        const chipsWrap = document.getElementById('modal-qty-chips');
        if (chipsWrap) {
            let chipsHtml = '';
            const curUnit = unitSelect ? unitSelect.value : food.unit;
            if (curUnit === 'g' || curUnit === 'ml') {
                [50, 100, 150, 200, 250].forEach(val => {
                    chipsHtml += `<button class="chip-btn" type="button" onclick="App.setQtyModalValue(${val})">${val}${curUnit}</button>`;
                });
            } else {
                [1, 2, 3, 4].forEach(val => {
                    chipsHtml += `<button class="chip-btn" type="button" onclick="App.setQtyModalValue(${val})">${val} ${curUnit}</button>`;
                });
            }
            chipsWrap.innerHTML = chipsHtml;
        }
        const confirmBtn = document.getElementById('btn-confirm-add-food');
        if (confirmBtn) {
            confirmBtn.innerText = existingItem ? '💾 Aggiorna Pasto' : '➕ Aggiungi al Pasto';
        }
        this.updateQtyModalMacros();
        modal.style.display = 'flex';
    },
    setQtyModalValue(val) {
        const qtyInput = document.getElementById('modal-food-qty-val');
        if (qtyInput) {
            qtyInput.value = val;
            this.updateQtyModalMacros();
        }
    },
    updateQtyModalMacros() {
        if (!this._activeQtyFood) return;
        const qtyInput = document.getElementById('modal-food-qty-val');
        const unitSelect = document.getElementById('modal-food-unit-select');
        const qty = qtyInput ? parseFloat(qtyInput.value) || 0 : 0;
        const unit = unitSelect ? unitSelect.value : (this._activeQtyFood.unit || 'g');
        const nutrients = Logic.scaleFoodNutrients(this._activeQtyFood, qty, unit);
        document.getElementById('modal-scaled-kcal').innerText = nutrients.kcal;
        document.getElementById('modal-scaled-carbs').innerText = `${nutrients.carbs}g`;
        document.getElementById('modal-scaled-pro').innerText = `${nutrients.pro}g`;
        document.getElementById('modal-scaled-fat').innerText = `${nutrients.fat}g`;
        document.getElementById('modal-micro-sugars').innerText = `${nutrients.sugars}g`;
        document.getElementById('modal-micro-fiber').innerText = `${nutrients.fiber}g`;
        document.getElementById('modal-micro-satfat').innerText = `${nutrients.satFat}g`;
        document.getElementById('modal-micro-unsatfat').innerText = `${nutrients.unSatFat}g`;
        document.getElementById('modal-micro-salt').innerText = `${nutrients.salt}g`;
        document.getElementById('modal-micro-sodium').innerText = `${nutrients.sodium}mg`;
    },
    closeQtyModal() {
        const modal = document.getElementById('modal-food-qty');
        if (modal) modal.style.display = 'none';
        this._activeQtyFood = null;
        this._editingMealItem = null;
    },
    toggleQtyMicroDetails() {
        const fields = document.getElementById('modal-qty-micro-fields');
        if (fields) {
            fields.style.display = fields.style.display === 'none' ? 'block' : 'none';
        }
    },
    confirmAddFoodToMeal() {
        if (!this._activeQtyFood) return;
        const dateStr = document.getElementById('nutri-date').value || new Date().toISOString().split('T')[0];
        if (!this.state.nutrition[dateStr]) {
            this.loadNutritionDate(dateStr);
        }
        const mealSelect = document.getElementById('modal-meal-select');
        const targetMealName = mealSelect ? mealSelect.value : (this._targetMealName || 'Colazione');
        const qtyInput = document.getElementById('modal-food-qty-val');
        const unitSelect = document.getElementById('modal-food-unit-select');
        const qty = parseFloat(qtyInput ? qtyInput.value : 0) || 0;
        const unit = unitSelect ? unitSelect.value : (this._activeQtyFood.unit || 'g');
        if (qty <= 0) {
            alert("Inserisci una quantità valida maggiore di 0");
            return;
        }
        const nutrients = Logic.scaleFoodNutrients(this._activeQtyFood, qty, unit);
        const dayData = this.state.nutrition[dateStr];
        let targetMealObj = dayData.meals.find(m => m.name === targetMealName || m.id === 'meal_' + targetMealName.toLowerCase());
        if (!targetMealObj) {
            targetMealObj = { id: 'meal_' + targetMealName.toLowerCase(), name: targetMealName, foods: [] };
            dayData.meals.push(targetMealObj);
        }
        if (this._editingMealItem) {
            const itemIdx = targetMealObj.foods.findIndex(f => f.id === this._editingMealItem.id);
            if (itemIdx >= 0) {
                targetMealObj.foods[itemIdx] = {
                    ...targetMealObj.foods[itemIdx],
                    qty,
                    unit,
                    ...nutrients
                };
            }
        } else {
            const newItem = {
                id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                foodId: this._activeQtyFood.id,
                name: this._activeQtyFood.name,
                brand: this._activeQtyFood.brand || '',
                qty,
                unit,
                baseQty: this._activeQtyFood.baseQty || 100,
                isCustom: !!this._activeQtyFood.isCustom,
                ...nutrients
            };
            targetMealObj.foods.push(newItem);
        }
        this.saveToStorage();
        this.closeQtyModal();
        this.clearFoodSearch();
        this.renderNutritionDisplay();
    },
    openEditMealItemModal(mealName, itemId) {
        const dateStr = document.getElementById('nutri-date').value || new Date().toISOString().split('T')[0];
        const dayData = this.state.nutrition[dateStr];
        if (!dayData || !dayData.meals) return;
        const mealObj = dayData.meals.find(m => m.name === mealName || m.id === 'meal_' + mealName.toLowerCase());
        if (!mealObj) return;
        const item = mealObj.foods.find(f => f.id === itemId);
        if (!item) return;
        const customFoods = this.state.customFoods || [];
        const combined = [...COMMON_FOODS, ...customFoods];
        let baseFood = combined.find(f => f.id === item.foodId || f.name === item.name);
        if (!baseFood) {
            baseFood = {
                id: item.foodId || item.id,
                name: item.name,
                category: 'Alimento',
                baseQty: item.baseQty || 100,
                unit: item.unit,
                kcal: item.kcal,
                carbs: item.carbs,
                pro: item.pro,
                fat: item.fat,
                satFat: item.satFat || 0,
                unSatFat: item.unSatFat || 0,
                sugars: item.sugars || 0,
                fiber: item.fiber || 0,
                salt: item.salt || 0,
                sodium: item.sodium || 0
            };
        }
        this.openQtyModal(baseFood, item, mealName);
    },
    deleteMealItem(mealName, itemId) {
        const dateStr = document.getElementById('nutri-date').value || new Date().toISOString().split('T')[0];
        const dayData = this.state.nutrition[dateStr];
        if (!dayData || !dayData.meals) return;
        const mealObj = dayData.meals.find(m => m.name === mealName || m.id === 'meal_' + mealName.toLowerCase());
        if (!mealObj) return;
        mealObj.foods = mealObj.foods.filter(f => f.id !== itemId);
        this.saveToStorage();
        this.renderNutritionDisplay();
    },
    openCustomFoodModal() {
        document.getElementById('custom-food-name').value = '';
        document.getElementById('custom-food-brand').value = '';
        document.getElementById('custom-food-unit').value = '100g';
        document.getElementById('custom-food-piece-weight').value = '';
        document.getElementById('custom-food-piece-weight-wrap').style.display = 'none';
        document.getElementById('custom-food-kcal').value = '';
        document.getElementById('custom-food-carbs').value = '';
        document.getElementById('custom-food-pro').value = '';
        document.getElementById('custom-food-fat').value = '';
        document.getElementById('custom-food-sugars').value = '';
        document.getElementById('custom-food-fiber').value = '';
        document.getElementById('custom-food-satfat').value = '';
        document.getElementById('custom-food-unsatfat').value = '';
        document.getElementById('custom-food-salt').value = '';
        document.getElementById('custom-food-sodium').value = '';
        document.getElementById('custom-food-vita').value = '';
        document.getElementById('custom-food-vitc').value = '';
        const modal = document.getElementById('modal-custom-food');
        if (modal) modal.style.display = 'flex';
    },
    closeCustomFoodModal() {
        const modal = document.getElementById('modal-custom-food');
        if (modal) modal.style.display = 'none';
    },
    toggleCustomFoodPieceWeight(unitVal) {
        const wrap = document.getElementById('custom-food-piece-weight-wrap');
        if (wrap) {
            wrap.style.display = unitVal === '1pezzo' ? 'block' : 'none';
        }
    },
    toggleCustomMicroDetails() {
        const fields = document.getElementById('custom-food-micro-fields');
        if (fields) {
            fields.style.display = fields.style.display === 'none' ? 'block' : 'none';
        }
    },
    saveCustomFood() {
        const name = document.getElementById('custom-food-name').value;
        const brand = document.getElementById('custom-food-brand').value;
        const unit = document.getElementById('custom-food-unit').value;
        const pieceWeight = document.getElementById('custom-food-piece-weight').value;
        const kcal = document.getElementById('custom-food-kcal').value;
        const carbs = document.getElementById('custom-food-carbs').value;
        const pro = document.getElementById('custom-food-pro').value;
        const fat = document.getElementById('custom-food-fat').value;
        const sugars = document.getElementById('custom-food-sugars').value;
        const fiber = document.getElementById('custom-food-fiber').value;
        const satFat = document.getElementById('custom-food-satfat').value;
        const unSatFat = document.getElementById('custom-food-unsatfat').value;
        const salt = document.getElementById('custom-food-salt').value;
        const sodium = document.getElementById('custom-food-sodium').value;
        const vitA = document.getElementById('custom-food-vita').value;
        const vitC = document.getElementById('custom-food-vitc').value;
        const foodData = {
            name,
            brand,
            unit,
            pieceWeight,
            baseQty: 100,
            kcal,
            carbs,
            pro,
            fat,
            sugars,
            fiber,
            satFat,
            unSatFat,
            salt,
            sodium,
            vitA,
            vitC
        };
        const validation = Logic.validateCustomFood(foodData);
        if (!validation.isValid) {
            alert("Attenzione: errori nei dati dell'alimento:\n" + Object.values(validation.errors).join('\n'));
            return;
        }
        const newCustomFood = validation.cleanData;
        if (!this.state.customFoods) this.state.customFoods = [];
        this.state.customFoods.push(newCustomFood);
        this.saveToStorage();
        this.closeCustomFoodModal();
        this.openQtyModal(newCustomFood);
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
    getMeasurementsList() {
        if (!this.state.nutrition) return [];
        const dates = Object.keys(this.state.nutrition).filter(d => {
            const item = this.state.nutrition[d];
            return item && (item.bfPercentage !== null && item.bfPercentage !== undefined || item.measurementMethod || (item.measurements && Object.keys(item.measurements).length > 0));
        });
        return dates.sort((a, b) => new Date(b) - new Date(a));
    },
    updateMeasurementMethodOptions() {
        const optMale = document.getElementById('opt-navy-male');
        const optFemale = document.getElementById('opt-navy-female');
        const gender = this.state.profile?.gender;
        if (optMale) optMale.style.display = (gender === 'F') ? 'none' : 'block';
        if (optFemale) optFemale.style.display = (gender === 'M') ? 'none' : 'block';
        const select = document.getElementById('measure-method');
        if (select) {
            if (select.value === 'navy_male' && gender === 'F') select.value = 'manual';
            if (select.value === 'navy_female' && gender === 'M') select.value = 'manual';
        }
    },
    onMeasurementMethodChange(methodVal) {
        const method = methodVal || document.getElementById('measure-method')?.value || 'manual';
        const fieldManual = document.getElementById('field-manual-bf');
        const fieldHeight = document.getElementById('field-height');
        const fieldNeck = document.getElementById('field-neck');
        const fieldWaist = document.getElementById('field-waist');
        const fieldHip = document.getElementById('field-hip');
        if (fieldManual) fieldManual.style.display = method === 'manual' ? 'block' : 'none';
        if (fieldHeight) fieldHeight.style.display = (method === 'navy_male' || method === 'navy_female' || method === 'bmi') ? 'block' : 'none';
        if (fieldNeck) fieldNeck.style.display = (method === 'navy_male' || method === 'navy_female') ? 'block' : 'none';
        if (fieldWaist) fieldWaist.style.display = (method === 'navy_male' || method === 'navy_female') ? 'block' : 'none';
        if (fieldHip) fieldHip.style.display = method === 'navy_female' ? 'block' : 'none';
        const heightInput = document.getElementById('measure-height');
        if (heightInput && (!heightInput.value || parseFloat(heightInput.value) <= 0) && this.state.profile && this.state.profile.height) {
            heightInput.value = this.state.profile.height;
        }
        this.updateMeasurementBFPreview();
    },
    updateMeasurementBFPreview() {
        const previewBadge = document.getElementById('measure-bf-preview');
        if (!previewBadge) return;
        const method = document.getElementById('measure-method')?.value || 'manual';
        const weight = parseFloat(document.getElementById('measure-weight')?.value);
        const height = parseFloat(document.getElementById('measure-height')?.value);
        const neck = parseFloat(document.getElementById('measure-neck')?.value);
        const waist = parseFloat(document.getElementById('measure-waist')?.value);
        const hip = parseFloat(document.getElementById('measure-hip')?.value);
        const manualBf = parseFloat(document.getElementById('measure-bf-manual')?.value);
        const params = {
            weight,
            height,
            neck,
            waist,
            hip,
            manualBf,
            bfPercentage: manualBf,
            gender: this.state.profile?.gender || 'M',
            dob: this.state.profile?.dob
        };
        const bf = Logic.calculateBodyFatByMethod(method, params);
        if (bf !== null && !isNaN(bf)) {
            previewBadge.innerText = `Stima BF: ${bf}%`;
            previewBadge.className = 'badge badge-success';
        } else {
            previewBadge.innerText = 'Stima BF: --%';
            previewBadge.className = 'badge badge-primary';
        }
    },
    async saveMeasurement(event) {
        if (event) event.preventDefault();
        const dateStr = document.getElementById('measure-date')?.value || new Date().toISOString().split('T')[0];
        const weight = document.getElementById('measure-weight')?.value;
        const method = document.getElementById('measure-method')?.value || 'manual';
        const manualBf = document.getElementById('measure-bf-manual')?.value;
        const height = document.getElementById('measure-height')?.value;
        const neck = document.getElementById('measure-neck')?.value;
        const waist = document.getElementById('measure-waist')?.value;
        const hip = document.getElementById('measure-hip')?.value;
        const payload = {
            date: dateStr,
            weight,
            method,
            manualBf,
            height,
            neck,
            waist,
            hip,
            gender: this.state.profile?.gender || 'M',
            dob: this.state.profile?.dob
        };
        const validation = Logic.validateMeasurementData(payload);
        if (!validation.isValid) {
            alert("Attenzione, errori nella misurazione:\n- " + Object.values(validation.errors).join('\n- '));
            return;
        }
        if (!this.state.nutrition[dateStr]) {
            this.loadNutritionDate(dateStr);
        }
        const dayData = this.state.nutrition[dateStr];
        dayData.weight = validation.cleanData.weight;
        dayData.bfPercentage = validation.bfPercentage;
        dayData.measurementMethod = validation.cleanData.measurementMethod;
        dayData.measurements = validation.cleanData.measurements;
        const photoInput = document.getElementById('measure-photo');
        if (photoInput && photoInput.files && photoInput.files.length > 0) {
            try {
                const file = photoInput.files[0];
                if (auth.currentUser) {
                    const downloadUrl = await StorageManager.uploadPhoto(file, auth.currentUser.uid, dateStr);
                    dayData.photoUrl = downloadUrl;
                }
            } catch (err) {
                alert("Errore durante il caricamento della foto. La misurazione è stata comunque salvata.");
            }
            photoInput.value = ""; // Reset input
        }
        this.saveToStorage();
        this.renderMeasurements();
        this.renderNutritionDisplay();
    },
    editMeasurement(dateStr) {
        const record = this.state.nutrition[dateStr];
        if (!record) return;
        const dateInput = document.getElementById('measure-date');
        const weightInput = document.getElementById('measure-weight');
        const methodSelect = document.getElementById('measure-method');
        const manualBfInput = document.getElementById('measure-bf-manual');
        const heightInput = document.getElementById('measure-height');
        const neckInput = document.getElementById('measure-neck');
        const waistInput = document.getElementById('measure-waist');
        const hipInput = document.getElementById('measure-hip');
        if (dateInput) dateInput.value = dateStr;
        if (weightInput) weightInput.value = record.weight || '';
        const method = record.measurementMethod || 'manual';
        if (methodSelect) methodSelect.value = method;
        const m = record.measurements || {};
        if (manualBfInput) manualBfInput.value = m.manualBf !== null && m.manualBf !== undefined ? m.manualBf : (record.bfPercentage !== null && record.bfPercentage !== undefined ? record.bfPercentage : '');
        if (heightInput) heightInput.value = m.height !== null && m.height !== undefined ? m.height : (this.state.profile?.height || '');
        if (neckInput) neckInput.value = m.neck !== null && m.neck !== undefined ? m.neck : '';
        if (waistInput) waistInput.value = m.waist !== null && m.waist !== undefined ? m.waist : '';
        if (hipInput) hipInput.value = m.hip !== null && m.hip !== undefined ? m.hip : '';
        this.onMeasurementMethodChange(method);
        const formCard = document.getElementById('measurement-form-card');
        if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    deleteMeasurement(dateStr) {
        if (!confirm(`Eliminare la misurazione del ${dateStr}?`)) return;
        if (this.state.nutrition[dateStr]) {
            delete this.state.nutrition[dateStr].bfPercentage;
            delete this.state.nutrition[dateStr].measurementMethod;
            delete this.state.nutrition[dateStr].measurements;
            const day = this.state.nutrition[dateStr];
            const hasMeals = day.meals && day.meals.some(m => m.foods && m.foods.length > 0);
            if (!day.weight && !hasMeals) {
                delete this.state.nutrition[dateStr];
            }
        }
        this.saveToStorage();
        this.renderMeasurements();
        this.renderNutritionDisplay();
    },
    renderMeasurements() {
        const dateInput = document.getElementById('measure-date');
        if (dateInput && !dateInput.value) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
        this.updateMeasurementMethodOptions();
        const methodSelect = document.getElementById('measure-method');
        const method = methodSelect ? methodSelect.value : 'manual';
        this.onMeasurementMethodChange(method);
        const container = document.getElementById('measurements-history-container');
        if (!container) return;
        const datesList = this.getMeasurementsList();
        if (datesList.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.9rem; font-style:italic;">Nessuna misurazione registrata.</div>`;
            return;
        }
        const methodLabels = {
            'manual': 'Manuale',
            'navy_male': 'US Navy (Uomo)',
            'navy_female': 'US Navy (Donna)',
            'bmi': 'BMI'
        };
        let html = '';
        datesList.forEach(d => {
            const item = this.state.nutrition[d];
            const weight = item.weight || '--';
            const bf = item.bfPercentage !== null && item.bfPercentage !== undefined ? item.bfPercentage : '--';
            const methodKey = item.measurementMethod || 'manual';
            const methodBadge = methodLabels[methodKey] || methodKey;
            const bodyComp = (weight !== '--' && bf !== '--') ? Logic.calculateBodyComposition(weight, bf) : { fatMass: '--', leanMass: '--' };
            html += `
                <div class="measurement-card">
                    <div class="measurement-header">
                        <div>
                            <span class="measurement-date">${d}</span>
                            <span class="badge badge-primary" style="font-size:0.75rem; margin-left:8px;">${methodBadge}</span>
                        </div>
                        <div>
                            <button class="chip-btn" onclick="App.editMeasurement('${d}')" title="Modifica">✏️</button>
                            <button class="chip-btn" style="color:var(--danger-color);" onclick="App.deleteMeasurement('${d}')" title="Elimina">🗑</button>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div><span style="color:var(--text-muted); font-size:0.85rem;">Peso:</span> <strong style="font-size:1.1rem; color:var(--text-main);">${weight} kg</strong></div>
                        <div><span style="color:var(--text-muted); font-size:0.85rem;">Massa Grassa:</span> <strong style="font-size:1.1rem; color:var(--primary-color);">${bf}%</strong></div>
                    </div>
                    <div class="measurement-body-comp">
                        <div class="comp-chip fat">
                            <span class="comp-chip-label">Fat Mass</span>
                            <span class="comp-chip-val">${bodyComp.fatMass} kg</span>
                        </div>
                        <div class="comp-chip lean">
                            <span class="comp-chip-label">Lean Mass</span>
                            <span class="comp-chip-val">${bodyComp.leanMass} kg</span>
                        </div>
                    </div>
                    ${item.photoUrl ? `
                    <div style="margin-top: 10px; border-top: 1px solid var(--glass-border); padding-top: 10px; text-align: center;">
                        <a href="${item.photoUrl}" target="_blank">
                            <img src="${item.photoUrl}" alt="Progress Photo" style="max-width: 100%; max-height: 200px; border-radius: 8px; object-fit: cover; border: 1px solid var(--glass-border);">
                        </a>
                    </div>
                    ` : ''}
                </div>
            `;
        });
        container.innerHTML = html;
    },
    renderHomeDashboard() {
        const todayStr = new Date().toISOString().split('T')[0];
        let workoutToday = this.state.history.find(w => {
            const date = new Date(w.globalStartTime || Date.now());
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
        document.getElementById('home-bf-display').innerText = calc.bf ? calc.bf.toFixed(1) + "%" : "--%";
        document.getElementById('home-streak-display').innerText = "🔥 " + this.state.history.length;
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

    onMacroKgSliderChange(macro, val) {
        const inputEl = document.getElementById(`input-${macro}-kg`);
        if (inputEl) inputEl.value = val;
        this.updateMacroKgValue(macro, parseFloat(val));
    },
    onMacroKgInputChange(macro, val) {
        const sliderEl = document.getElementById(`slider-${macro}-kg`);
        if (sliderEl) sliderEl.value = val;
        this.updateMacroKgValue(macro, parseFloat(val));
    },
    updateMacroKgValue(macro, val) {
        const numVal = isNaN(val) ? 0 : val;
        const planning = this.state.nutritionPlanning;
        const initialMacros = Logic.calculateMacrosFromKg(planning.weight, planning.carbsPerKg, planning.proPerKg, planning.fatPerKg);
        const targetKcal = (planning.normocalorica && planning.normocalorica.kcal) ? planning.normocalorica.kcal : initialMacros.totalKcal;
        const key = `${macro}PerKg`;
        planning[key] = numVal;
        if (planning.lockedMacro && (macro === 'carbs' || macro === 'fat')) {
            const modulated = Logic.modulateMacroRatio({
                weight: planning.weight,
                carbsPerKg: planning.carbsPerKg,
                proPerKg: planning.proPerKg,
                fatPerKg: planning.fatPerKg,
                lockedMacro: macro,
                targetValue: targetKcal,
                targetType: 'kcal'
            });
            planning.carbsPerKg = modulated.carbsPerKg;
            planning.fatPerKg = modulated.fatPerKg;
        }
        this.renderNutritionPlanning();
        this.saveToStorage();
    },
    setMacroLock(lockedMacro) {
        this.state.nutritionPlanning.lockedMacro = lockedMacro;
        this.renderNutritionPlanning();
        this.saveToStorage();
    },
    updateNormoBaseline() {
        const k = parseFloat(document.getElementById('normo-kcal').value) || 2500;
        const c = parseFloat(document.getElementById('normo-carbs').value) || 300;
        const p = parseFloat(document.getElementById('normo-pro').value) || 160;
        const f = parseFloat(document.getElementById('normo-fat').value) || 70;
        this.state.nutritionPlanning.normocalorica = { kcal: k, carbs: c, pro: p, fat: f };
        this.renderNutritionPlanning();
        this.saveToStorage();
    },
    copyTDEEToNormo() {
        const calc = Logic.calculateTDEEAndMacros(this.state);
        const tdee = calc.tdee || 2500;
        const carbs = calc.carbs || 300;
        const pro = calc.pro || 160;
        const fat = calc.fat || 70;
        this.state.nutritionPlanning.normocalorica = { kcal: tdee, carbs, pro, fat };
        this.renderNutritionPlanning();
        this.saveToStorage();
    },
    switchPlanningChartPeriod(period) {
        this.state.nutritionPlanning.chartPeriod = period;
        document.querySelectorAll('.chart-period-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(`btn-chart-${period}d`);
        if (activeBtn) activeBtn.classList.add('active');
        this.renderNutritionTrendChart();
    },
    getLatestWeight() {
        if (!this.state.nutrition) return null;
        let today = new Date().toISOString().split('T')[0];
        if (this.state.nutrition[today] && this.state.nutrition[today].weight) {
            return parseFloat(this.state.nutrition[today].weight);
        }
        let dates = Object.keys(this.state.nutrition).sort((a,b) => new Date(b) - new Date(a));
        for (let d of dates) {
            if (this.state.nutrition[d] && this.state.nutrition[d].weight) {
                return parseFloat(this.state.nutrition[d].weight);
            }
        }
        return null;
    },
    renderNutritionPlanning() {
        if (!this.state.nutritionPlanning) {
            this.state.nutritionPlanning = {
                weight: 80,
                carbsPerKg: 3.5,
                proPerKg: 2.0,
                fatPerKg: 1.0,
                lockedMacro: null,
                chartPeriod: 7,
                normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
            };
        }
        let latestWeight = this.getLatestWeight();
        const displayEl = document.getElementById('plan-weight-display');
        if (latestWeight) {
            this.state.nutritionPlanning.weight = latestWeight;
            if (displayEl) displayEl.innerHTML = `${latestWeight} <span style="font-size:0.8rem; font-weight:normal; color:var(--text-muted);">kg</span>`;
        } else {
            this.state.nutritionPlanning.weight = 0;
            if (displayEl) displayEl.innerHTML = `<span style="font-size:0.9rem; color:var(--warning-color);">Inserisci peso in Misurazioni</span>`;
        }
        const planning = this.state.nutritionPlanning;
        const sliderC = document.getElementById('slider-carbs-kg');
        const inputC = document.getElementById('input-carbs-kg');
        if (sliderC && document.activeElement !== sliderC) sliderC.value = planning.carbsPerKg;
        if (inputC && document.activeElement !== inputC) inputC.value = planning.carbsPerKg;
        const sliderP = document.getElementById('slider-pro-kg');
        const inputP = document.getElementById('input-pro-kg');
        if (sliderP && document.activeElement !== sliderP) sliderP.value = planning.proPerKg;
        if (inputP && document.activeElement !== inputP) inputP.value = planning.proPerKg;
        const sliderF = document.getElementById('slider-fat-kg');
        const inputF = document.getElementById('input-fat-kg');
        if (sliderF && document.activeElement !== sliderF) sliderF.value = planning.fatPerKg;
        if (inputF && document.activeElement !== inputF) inputF.value = planning.fatPerKg;
        const normoKcal = document.getElementById('normo-kcal');
        const normoCarbs = document.getElementById('normo-carbs');
        const normoPro = document.getElementById('normo-pro');
        const normoFat = document.getElementById('normo-fat');
        if (normoKcal && document.activeElement !== normoKcal) normoKcal.value = planning.normocalorica.kcal;
        if (normoCarbs && document.activeElement !== normoCarbs) normoCarbs.value = planning.normocalorica.carbs;
        if (normoPro && document.activeElement !== normoPro) normoPro.value = planning.normocalorica.pro;
        if (normoFat && document.activeElement !== normoFat) normoFat.value = planning.normocalorica.fat;
        const totals = Logic.calculateMacrosFromKg(planning.weight, planning.carbsPerKg, planning.proPerKg, planning.fatPerKg);
        const totalKcalEl = document.getElementById('plan-total-kcal');
        if (totalKcalEl) totalKcalEl.innerHTML = `${totals.totalKcal} <span style="font-size:1rem; font-weight:normal; color:var(--text-muted);">kcal</span>`;
        const totalCarbsEl = document.getElementById('plan-total-carbs');
        const carbsKcalEl = document.getElementById('plan-carbs-kcal');
        if (totalCarbsEl) totalCarbsEl.innerText = `${totals.carbsGrams}g`;
        if (carbsKcalEl) carbsKcalEl.innerText = `${totals.carbsKcal} kcal`;
        const totalProEl = document.getElementById('plan-total-pro');
        const proKcalEl = document.getElementById('plan-pro-kcal');
        if (totalProEl) totalProEl.innerText = `${totals.proGrams}g`;
        if (proKcalEl) proKcalEl.innerText = `${totals.proKcal} kcal`;
        const totalFatEl = document.getElementById('plan-total-fat');
        const fatKcalEl = document.getElementById('plan-fat-kcal');
        if (totalFatEl) totalFatEl.innerText = `${totals.fatGrams}g`;
        if (fatKcalEl) fatKcalEl.innerText = `${totals.fatKcal} kcal`;
        const diff = Logic.calculateNormocaloricaDiff(totals, planning.normocalorica);
        if (diff) {
            const kcalDeltaEl = document.getElementById('badge-kcal-delta');
            if (kcalDeltaEl) {
                kcalDeltaEl.innerText = `${diff.kcalDiff.formatted} Normo`;
                kcalDeltaEl.className = 'badge ' + (diff.kcalPct > 2 ? 'badge-success' : diff.kcalPct < -2 ? 'badge-danger' : 'badge-primary');
            }
            const carbsDeltaEl = document.getElementById('badge-carbs-delta');
            if (carbsDeltaEl) carbsDeltaEl.innerText = `CHO: ${diff.carbsDiff.formatted}`;
            const proDeltaEl = document.getElementById('badge-pro-delta');
            if (proDeltaEl) proDeltaEl.innerText = `PRO: ${diff.proDiff.formatted}`;
            const fatDeltaEl = document.getElementById('badge-fat-delta');
            if (fatDeltaEl) fatDeltaEl.innerText = `FAT: ${diff.fatDiff.formatted}`;
        }
        const btnLockCarbs = document.getElementById('btn-lock-carbs');
        const btnLockFat = document.getElementById('btn-lock-fat');
        const btnLockNone = document.getElementById('btn-lock-none');
        if (btnLockCarbs) btnLockCarbs.classList.toggle('active', planning.lockedMacro === 'carbs');
        if (btnLockFat) btnLockFat.classList.toggle('active', planning.lockedMacro === 'fat');
        if (btnLockNone) btnLockNone.classList.toggle('active', !planning.lockedMacro);
        this.renderNutritionTrendChart();
    },
    renderNutritionTrendChart() {
        if (typeof Chart === 'undefined') return;
        const canvas = document.getElementById('planningChart');
        if (!canvas) return;
        if (window.nutritionTrendChartInstance) {
            window.nutritionTrendChartInstance.destroy();
        }
        const period = (this.state.nutritionPlanning && this.state.nutritionPlanning.chartPeriod) ? parseInt(this.state.nutritionPlanning.chartPeriod) : 7;
        const labels = [];
        const actualData = [];
        const targetData = [];
        const targetKcal = (this.state.nutritionPlanning && this.state.nutritionPlanning.normocalorica && this.state.nutritionPlanning.normocalorica.kcal) ? this.state.nutritionPlanning.normocalorica.kcal : 2500;
        const today = new Date();
        for (let i = period - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const labelStr = `${d.getDate()}/${d.getMonth() + 1}`;
            labels.push(labelStr);
            const nut = this.state.nutrition ? this.state.nutrition[dateStr] : null;
            const kcalVal = nut && nut.kcal ? parseFloat(nut.kcal) : 0;
            actualData.push(kcalVal);
            targetData.push(targetKcal);
        }
        const ctx = canvas.getContext('2d');
        window.nutritionTrendChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Kcal Registrate',
                        data: actualData,
                        backgroundColor: 'rgba(14, 165, 233, 0.6)',
                        borderColor: '#0ea5e9',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Normocalorica Target',
                        data: targetData,
                        type: 'line',
                        borderColor: '#22c55e',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#94a3b8', font: { size: 10 } }
                    }
                },
                scales: {
                    x: { ticks: { color: 'rgba(255,255,255,0.7)', font: { size: 10 } } },
                    y: { ticks: { color: 'rgba(255,255,255,0.7)', font: { size: 10 } }, beginAtZero: true }
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
        this.renderNutritionPlanning();
        this.renderMeasurements();
    }
};
window.App = App; // Esponi globale per poter essere chiamato dall'HTML (onClick)
window.onload = () => App.init();

