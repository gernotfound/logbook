// js/logic.js
// Funzioni logiche pure, scorporate dalla UI e dal database

export const Logic = {
                        MUSCLES: [
        { id: "abductors_right", name: "Abduttore Destro" },
        { id: "abductors_left", name: "Abduttore Sinistro" },
        { id: "abductors", name: "Abduttori (Esterno Coscia)" },
        { id: "abs", name: "Addome (Retto dell'Addome)" },
        { id: "abs_upper", name: "Addominali Alti" },
        { id: "abs_lower", name: "Addominali Bassi (V-Shape)" },
        { id: "adductors_right", name: "Adduttore Destro" },
        { id: "adductors_left", name: "Adduttore Sinistro" },
        { id: "adductors", name: "Adduttori (Interno Coscia)" },
        { id: "forearms", name: "Avambracci (Globale)" },
        { id: "forearms_right", name: "Avambraccio Destro" },
        { id: "forearms_left", name: "Avambraccio Sinistro" },
        { id: "biceps_right", name: "Bicipite Destro" },
        { id: "biceps_left", name: "Bicipite Sinistro" },
        { id: "biceps", name: "Bicipiti (Globale)" },
        { id: "brachialis", name: "Brachiale" },
        { id: "biceps_short", name: "Capo Breve del Bicipite (Globale)" },
        { id: "biceps_short_right", name: "Capo Breve del Bicipite Destro" },
        { id: "biceps_short_left", name: "Capo Breve del Bicipite Sinistro" },
        { id: "triceps_lateral", name: "Capo Laterale del Tricipite (Globale)" },
        { id: "triceps_lateral_right", name: "Capo Laterale del Tricipite Destro" },
        { id: "triceps_lateral_left", name: "Capo Laterale del Tricipite Sinistro" },
        { id: "biceps_long", name: "Capo Lungo del Bicipite (Globale)" },
        { id: "biceps_long_right", name: "Capo Lungo del Bicipite Destro" },
        { id: "biceps_long_left", name: "Capo Lungo del Bicipite Sinistro" },
        { id: "triceps_long", name: "Capo Lungo del Tricipite (Globale)" },
        { id: "triceps_long_right", name: "Capo Lungo del Tricipite Destro" },
        { id: "triceps_long_left", name: "Capo Lungo del Tricipite Sinistro" },
        { id: "triceps_medial", name: "Capo Mediale del Tricipite (Globale)" },
        { id: "triceps_medial_right", name: "Capo Mediale del Tricipite Destro" },
        { id: "triceps_medial_left", name: "Capo Mediale del Tricipite Sinistro" },
        { id: "core", name: "Core (Globale)" },
        { id: "delts_front", name: "Deltoide Anteriore (Globale)" },
        { id: "delts_front_right", name: "Deltoide Anteriore Destro" },
        { id: "delts_front_left", name: "Deltoide Anteriore Sinistro" },
        { id: "delts_side", name: "Deltoide Laterale (Globale)" },
        { id: "delts_side_right", name: "Deltoide Laterale Destro" },
        { id: "delts_side_left", name: "Deltoide Laterale Sinistro" },
        { id: "delts_rear", name: "Deltoide Posteriore (Globale)" },
        { id: "delts_rear_right", name: "Deltoide Posteriore Destro" },
        { id: "delts_rear_left", name: "Deltoide Posteriore Sinistro" },
        { id: "back", name: "Dorso (Globale)" },
        { id: "chest_lower", name: "Fascio Addominale (Petto Basso)" },
        { id: "chest_lower_right", name: "Fascio Addominale Destro" },
        { id: "chest_lower_left", name: "Fascio Addominale Sinistro" },
        { id: "chest_upper", name: "Fascio Clavicolare (Petto Alto)" },
        { id: "chest_upper_right", name: "Fascio Clavicolare Destro" },
        { id: "chest_upper_left", name: "Fascio Clavicolare Sinistro" },
        { id: "hamstrings_right", name: "Femorale Destro" },
        { id: "hamstrings_left", name: "Femorale Sinistro" },
        { id: "hamstrings", name: "Femorali (Ischiocrurali Globale)" },
        { id: "hand_flexors_right", name: "Flessori Mano Destra" },
        { id: "hand_flexors_left", name: "Flessori Mano Sinistra" },
        { id: "glutes", name: "Glutei (Globale)" },
        { id: "glutes_right", name: "Gluteo Destro" },
        { id: "glutes_left", name: "Gluteo Sinistro" },
        { id: "lats", name: "Gran Dorsale (Globale)" },
        { id: "lats_right", name: "Gran Dorsale Destro" },
        { id: "lats_left", name: "Gran Dorsale Sinistro" },
        { id: "lower_back", name: "Lombari" },
        { id: "obliques", name: "Obliqui" },
        { id: "chest", name: "Petto (Globale)" },
        { id: "chest_right", name: "Petto Destro" },
        { id: "chest_left", name: "Petto Sinistro" },
        { id: "calves", name: "Polpacci (Globale)" },
        { id: "calves_right", name: "Polpaccio Destro" },
        { id: "calves_left", name: "Polpaccio Sinistro" },
        { id: "quads_right", name: "Quadricipite Destro" },
        { id: "quads_left", name: "Quadricipite Sinistro" },
        { id: "quads", name: "Quadricipiti (Globale)" },
        { id: "rhomboids", name: "Romboidi" },
        { id: "shoulders", name: "Spalle (Globale)" },
        { id: "traps", name: "Trapezi (Globale)" },
        { id: "traps_right", name: "Trapezio Destro" },
        { id: "traps_left", name: "Trapezio Sinistro" },
        { id: "triceps_right", name: "Tricipite Destro" },
        { id: "triceps_left", name: "Tricipite Sinistro" },
        { id: "triceps", name: "Tricipiti (Globale)" },
    ],

    generateId(prefix) { 
        return prefix + '_' + Math.random().toString(36).substr(2, 9); 
    },

    formatTime(ms, showHours = false) {
        let totalSec = Math.floor(ms / 1000);
        let h = Math.floor(totalSec / 3600); 
        let m = Math.floor((totalSec % 3600) / 60); 
        let s = totalSec % 60;
        let p = n => n.toString().padStart(2, '0');
        return showHours ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
    },

    calculateBodyFat(weight, profile) {
        if(!profile || !profile.height || !profile.dob || !weight) return null;
        
        const hMeters = parseFloat(profile.height) / 100;
        const wKg = parseFloat(weight);
        if (hMeters <= 0 || wKg <= 0) return null;
        
        const bmi = wKg / (hMeters * hMeters);
        const dobDate = new Date(profile.dob);
        const age = Math.abs(new Date(Date.now() - dobDate.getTime()).getUTCFullYear() - 1970);
        const sexFactor = profile.gender === 'M' ? 1 : 0;
        
        let bf = (1.20 * bmi) + (0.23 * age) - (10.8 * sexFactor) - 5.4;
        return Math.max(2, bf).toFixed(1); 
    },

    validateInputData(value, type) {
        if(value === '' || value === null) return '';
        if(type === 'int') {
            return Math.abs(parseInt(value.toString().replace(/[^0-9]/g, ''), 10)) || '';
        } else if(type === 'float') {
            let val = parseFloat(value);
            return val < 0 ? Math.abs(val) : val;
        }
        return value;
    },

    // Calcola il TDEE basato su un array di oggetti nutrizione { date, weight, kcal }
    // cronologicamente ordinati (dal più vecchio al più recente)
    calculateTDEE(nutritionHistoryList) {
        // Filtriamo solo i giorni che hanno sia peso che kcal validi
        const validDays = nutritionHistoryList.filter(d => parseFloat(d.weight) > 0 && parseFloat(d.kcal) > 0);
        
        if (validDays.length < 7) { 
            return { error: true, message: `Raccolta dati in corso... (${validDays.length}/7 giorni richiesti)` }; 
        }
        
        // Prendiamo fino agli ultimi 14 giorni validi per il calcolo
        const recentDays = validDays.slice(-14); 
        const wLast = parseFloat(recentDays[recentDays.length - 1].weight);
        const wFirst = parseFloat(recentDays[0].weight);
        
        const firstDate = new Date(recentDays[0].date);
        const lastDate = new Date(recentDays[recentDays.length - 1].date);
        const diffDays = Math.ceil(Math.abs(lastDate - firstDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return { error: true, message: "Dati insufficienti (stesso giorno)" };
        
        const avgKcal = recentDays.reduce((sum, d) => sum + parseFloat(d.kcal), 0) / recentDays.length;
        const weightDiff = wLast - wFirst;
        
        // Formula: Kcal medie - (DeltaPeso / Giorni * 7700 kcal per kg)
        const estimatedTDEE = avgKcal - ((weightDiff / diffDays) * 7700);

        return {
            error: false,
            tdee: Math.round(estimatedTDEE),
            avgKcal: Math.round(avgKcal),
            weightDiff: weightDiff.toFixed(2),
            daysTracked: recentDays.length,
            timeSpanDays: diffDays
        };
    }
};





