// js/logic.js
// Funzioni logiche pure, scorporate dalla UI e dal database

export const Logic = {
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
