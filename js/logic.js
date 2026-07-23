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
    GROUP_MAP: {
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
    },
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
            return value.toString().replace(/[^0-9]/g, '');
        } else if(type === 'float') {
            let val = value.toString().replace(/[^0-9.]/g, '');
            const parts = val.split('.');
            if (parts.length > 2) {
                val = parts[0] + '.' + parts.slice(1).join('');
            }
            return val;
        }
        return value;
    },
    calculateTDEE(nutritionHistoryList) {
        const validDays = nutritionHistoryList.filter(d => parseFloat(d.weight) > 0 && parseFloat(d.kcal) > 0);
        if (validDays.length < 7) { 
            return { error: true, message: `Raccolta dati in corso... (${validDays.length}/7 giorni richiesti)` }; 
        }
        const recentDays = validDays.slice(-14); 
        const wLast = parseFloat(recentDays[recentDays.length - 1].weight);
        const wFirst = parseFloat(recentDays[0].weight);
        const firstDate = new Date(recentDays[0].date);
        const lastDate = new Date(recentDays[recentDays.length - 1].date);
        const diffDays = Math.ceil(Math.abs(lastDate - firstDate) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return { error: true, message: "Dati insufficienti (stesso giorno)" };
        const avgKcal = recentDays.reduce((sum, d) => sum + parseFloat(d.kcal), 0) / recentDays.length;
        const weightDiff = wLast - wFirst;
        const estimatedTDEE = avgKcal - ((weightDiff / diffDays) * 7700);
        return {
            error: false,
            tdee: Math.round(estimatedTDEE),
            avgKcal: Math.round(avgKcal),
            weightDiff: weightDiff.toFixed(2),
            daysTracked: recentDays.length,
            timeSpanDays: diffDays
        };
    },
    calculateDailyCalories(carbs, pro, fat) {
        let c = 0, p = 0, f = 0;
        if (typeof carbs === 'object' && carbs !== null) {
            c = parseFloat(carbs.carbs || carbs.carbsGrams || carbs.carbsG) || 0;
            p = parseFloat(carbs.pro || carbs.proGrams || carbs.proG) || 0;
            f = parseFloat(carbs.fat || carbs.fatGrams || carbs.fatG) || 0;
        } else {
            c = parseFloat(carbs) || 0;
            p = parseFloat(pro) || 0;
            f = parseFloat(fat) || 0;
        }
        return Math.round((c * 4) + (p * 4) + (f * 9));
    },
    calculateMacrosFromKg(weight, carbsPerKg, proPerKg, fatPerKg) {
        let w, c, p, f;
        if (typeof weight === 'object' && weight !== null) {
            w = parseFloat(weight.weight) || 0;
            c = parseFloat(weight.carbsPerKg) || 0;
            p = parseFloat(weight.proPerKg) || 0;
            f = parseFloat(weight.fatPerKg) || 0;
        } else {
            w = parseFloat(weight) || 0;
            c = parseFloat(carbsPerKg) || 0;
            p = parseFloat(proPerKg) || 0;
            f = parseFloat(fatPerKg) || 0;
        }
        if (w <= 0 || c < 0 || p < 0 || f < 0) {
            return { carbsGrams: 0, proGrams: 0, fatGrams: 0, carbsG: 0, proG: 0, fatG: 0, carbsKcal: 0, proKcal: 0, fatKcal: 0, totalKcal: 0 };
        }
        const carbsGrams = Math.round(w * c * 10) / 10;
        const proGrams = Math.round(w * p * 10) / 10;
        const fatGrams = Math.round(w * f * 10) / 10;
        const carbsKcal = Math.round(carbsGrams * 4);
        const proKcal = Math.round(proGrams * 4);
        const fatKcal = Math.round(fatGrams * 9);
        const totalKcal = carbsKcal + proKcal + fatKcal;
        return {
            carbsGrams, proGrams, fatGrams,
            carbsG: carbsGrams, proG: proGrams, fatG: fatGrams,
            carbsKcal, proKcal, fatKcal, totalKcal
        };
    },
    calculateMacros(params) {
        return this.calculateMacrosFromKg(params);
    },
    calculateMacroRatio(carbsGrams, fatGrams) {
        const cG = parseFloat(carbsGrams) || 0;
        const fG = parseFloat(fatGrams) || 0;
        const cKcal = cG * 4;
        const fKcal = fG * 9;
        if (fKcal <= 0) return { ratioKcal: cKcal > 0 ? Infinity : 0, ratioGrams: fG > 0 ? Math.round((cG / fG) * 100) / 100 : 0, ratioString: fKcal === 0 ? 'N/A' : '1.0:0' };
        const ratioKcal = Math.round((cKcal / fKcal) * 100) / 100;
        const ratioGrams = Math.round((cG / fG) * 100) / 100;
        return { ratioKcal, ratioGrams, ratioString: `${ratioKcal}:1` };
    },
    modulateMacroRatio(param1, param2, param3, param4, param5, param6) {
        let weight, carbsPerKg, proPerKg, fatPerKg, lockedMacro, targetValue, targetType;
        if (typeof param1 === 'object' && param1 !== null) {
            weight = param1.weight;
            carbsPerKg = param1.carbsPerKg;
            proPerKg = param1.proPerKg;
            fatPerKg = param1.fatPerKg;
            lockedMacro = param1.lockedMacro;
            targetValue = param1.targetValue;
            targetType = param1.targetType || 'ratio';
        } else {
            weight = param1;
            carbsPerKg = param2;
            proPerKg = param3;
            fatPerKg = param4;
            lockedMacro = param5;
            targetValue = param6;
            targetType = 'kcal';
        }
        const w = parseFloat(weight);
        let c = parseFloat(carbsPerKg) || 0;
        let f = parseFloat(fatPerKg) || 0;
        const p = parseFloat(proPerKg) || 0;
        if (isNaN(w) || w <= 0) return { carbsPerKg: c, fatPerKg: f };
        const target = parseFloat(targetValue);
        if (isNaN(target) || target <= 0) return { carbsPerKg: Math.round(c * 100) / 100, fatPerKg: Math.round(f * 100) / 100 };
        if (lockedMacro === 'carbs') {
            if (targetType === 'ratio') {
                f = (c * 4) / (9 * target);
            } else if (targetType === 'kcal') {
                const proKcal = p * w * 4;
                const carbsKcal = c * w * 4;
                const fatKcal = Math.max(0, target - proKcal - carbsKcal);
                f = fatKcal / (w * 9);
            }
        } else if (lockedMacro === 'fat') {
            if (targetType === 'ratio') {
                c = (target * f * 9) / 4;
            } else if (targetType === 'kcal') {
                const proKcal = p * w * 4;
                const fatKcal = f * w * 9;
                const carbsKcal = Math.max(0, target - proKcal - fatKcal);
                c = carbsKcal / (w * 4);
            }
        }
        return {
            carbsPerKg: Math.round(c * 100) / 100,
            fatPerKg: Math.round(f * 100) / 100
        };
    },
    calculateNormocaloricaDiff(current, normocalorica) {
        if (!current || !normocalorica) return null;
        const getDiff = (curr, norm) => {
            const c = parseFloat(curr) || 0;
            const n = parseFloat(norm) || 0;
            if (n <= 0) return { pct: 0, formatted: '0.0%' };
            const diffPct = Math.round(((c - n) / n) * 1000) / 10;
            const sign = diffPct > 0 ? '+' : '';
            return {
                pct: diffPct,
                formatted: `${sign}${diffPct.toFixed(1)}%`
            };
        };
        const currKcal = current.totalKcal !== undefined ? current.totalKcal : current.kcal;
        const currCarbs = current.carbsGrams !== undefined ? current.carbsGrams : current.carbs;
        const currPro = current.proGrams !== undefined ? current.proGrams : current.pro;
        const currFat = current.fatGrams !== undefined ? current.fatGrams : current.fat;
        const kcalDiff = getDiff(currKcal, normocalorica.kcal);
        const carbsDiff = getDiff(currCarbs, normocalorica.carbs);
        const proDiff = getDiff(currPro, normocalorica.pro);
        const fatDiff = getDiff(currFat, normocalorica.fat);
        return {
            kcalPct: kcalDiff.pct,
            carbsPct: carbsDiff.pct,
            proPct: proDiff.pct,
            fatPct: fatDiff.pct,
            formatted: kcalDiff.formatted,
            kcalDiff,
            carbsDiff,
            proDiff,
            fatDiff
        };
    },
    calculateTDEEAndMacros(state) {
        if (!state) return { tdee: 2500, bf: null, carbs: 300, pro: 160, fat: 70, totalKcal: 2500 };
        let tdeeVal = 2500;
        if (state.nutritionPlanning && state.nutritionPlanning.normocalorica && state.nutritionPlanning.normocalorica.kcal) {
            tdeeVal = state.nutritionPlanning.normocalorica.kcal;
        }
        if (state.nutrition && typeof state.nutrition === 'object') {
            const dates = Object.keys(state.nutrition).sort((a,b) => new Date(a) - new Date(b));
            const historyList = dates.map(d => ({ date: d, weight: state.nutrition[d].weight, kcal: state.nutrition[d].kcal }));
            const tdeeRes = this.calculateTDEE(historyList);
            if (!tdeeRes.error && tdeeRes.tdee) {
                tdeeVal = tdeeRes.tdee;
            }
        }
        const planning = state.nutritionPlanning || { weight: 80, carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 };
        const weight = parseFloat(planning.weight) || 80;
        let bfVal = null;
        if (state.profile) {
            const bfStr = this.calculateBodyFat(weight, state.profile);
            if (bfStr) bfVal = parseFloat(bfStr);
        }
        const macros = this.calculateMacrosFromKg(weight, planning.carbsPerKg, planning.proPerKg, planning.fatPerKg);
        return {
            tdee: tdeeVal,
            bf: bfVal,
            carbs: macros.carbsGrams,
            pro: macros.proGrams,
            fat: macros.fatGrams,
            totalKcal: macros.totalKcal
        };
    },
    calculateUsNavyBodyFat({ gender, height, waist, neck, hip }) {
        const h = parseFloat(height);
        const w = parseFloat(waist);
        const n = parseFloat(neck);
        const hp = parseFloat(hip);
        const g = (gender || 'M').toUpperCase();
        if (isNaN(h) || isNaN(w) || isNaN(n) || h < 50 || h > 250 || w <= 0 || n <= 0) return null;
        if (g === 'M') {
            if (w <= n) return null;
            const logWaistNeck = Math.log10(w - n);
            const logHeight = Math.log10(h);
            const denom = 1.0324 - (0.19077 * logWaistNeck) + (0.15456 * logHeight);
            if (denom <= 0) return null;
            const bf = (495 / denom) - 450;
            return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
        } else if (g === 'F') {
            if (isNaN(hp) || hp <= 0 || (w + hp) <= n) return null;
            const logWaistHipNeck = Math.log10(w + hp - n);
            const logHeight = Math.log10(h);
            const denom = 1.29579 - (0.35004 * logWaistHipNeck) + (0.22100 * logHeight);
            if (denom <= 0) return null;
            const bf = (495 / denom) - 450;
            return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
        }
        return null;
    },
    calculateBodyFatByMethod(method, params) {
        if (!method || !params || typeof params !== 'object') return null;
        const m = (method || '').toString().toLowerCase().trim();
        if (m === 'manual') {
            const val = parseFloat(params.bfPercentage !== undefined ? params.bfPercentage : (params.manualBf !== undefined ? params.manualBf : params.bf));
            if (isNaN(val) || val < 0 || val > 100) return null;
            return Math.round(val * 10) / 10;
        }
        if (m === 'navy_male') {
            const height = parseFloat(params.height);
            const waist = parseFloat(params.waist);
            const neck = parseFloat(params.neck);
            return this.calculateUsNavyBodyFat({ gender: 'M', height, waist, neck });
        }
        if (m === 'navy_female') {
            const height = parseFloat(params.height);
            const waist = parseFloat(params.waist);
            const neck = parseFloat(params.neck);
            const hip = parseFloat(params.hip);
            return this.calculateUsNavyBodyFat({ gender: 'F', height, waist, neck, hip });
        }
        if (m === 'bmi') {
            const weight = parseFloat(params.weight);
            const height = parseFloat(params.height);
            if (isNaN(weight) || isNaN(height) || weight <= 0 || height <= 0) return null;
            const hMeters = height / 100;
            const bmi = weight / (hMeters * hMeters);
            let age = 30;
            if (params.age !== undefined && !isNaN(parseFloat(params.age))) {
                age = parseFloat(params.age);
            } else if (params.dob) {
                const dobDate = new Date(params.dob);
                if (!isNaN(dobDate.getTime())) {
                    age = Math.abs(new Date(Date.now() - dobDate.getTime()).getUTCFullYear() - 1970);
                }
            }
            const sexFactor = (params.gender === 'F' || params.gender === 'female') ? 0 : 1;
            const bf = (1.20 * bmi) + (0.23 * age) - (10.8 * sexFactor) - 5.4;
            if (isNaN(bf)) return null;
            return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
        }
        return null;
    },
    validateMeasurementData(data) {
        const errors = {};
        if (!data || typeof data !== 'object') {
            return { isValid: false, errors: { general: "Dati non validi" }, cleanData: null, bfPercentage: null };
        }
        const dateStr = String(data.date || '').trim();
        if (!dateStr || isNaN(Date.parse(dateStr))) {
            errors.date = "Data non valida (richiesto formato AAAA-MM-GG)";
        }
        const weight = parseFloat(data.weight);
        if (isNaN(weight) || weight <= 0) {
            errors.weight = "Il peso corporeo deve essere maggiore di 0 kg";
        }
        const method = (data.method || data.measurementMethod || 'manual').toLowerCase().trim();
        const validMethods = ['manual', 'navy_male', 'navy_female', 'bmi'];
        if (!validMethods.includes(method)) {
            errors.method = "Metodo di misurazione non supportato";
        }
        const height = parseFloat(data.height);
        const neck = parseFloat(data.neck);
        const waist = parseFloat(data.waist);
        const hip = parseFloat(data.hip);
        const manualBf = parseFloat(data.manualBf !== undefined ? data.manualBf : data.bfPercentage);
        if (method === 'manual') {
            if (isNaN(manualBf) || manualBf < 0 || manualBf > 100) {
                errors.manualBf = "La percentuale di massa grassa manuale deve essere compresa tra 0% e 100%";
            }
        } else if (method === 'navy_male') {
            if (isNaN(height) || height <= 0) errors.height = "Altezza richiesta e maggiore di 0 cm";
            if (isNaN(neck) || neck <= 0) errors.neck = "Circonferenza collo richiesta e maggiore di 0 cm";
            if (isNaN(waist) || waist <= 0) errors.waist = "Circonferenza vita richiesta e maggiore di 0 cm";
            if (!errors.waist && !errors.neck && waist <= neck) {
                errors.waist = "La circonferenza vita deve essere maggiore del collo";
            }
        } else if (method === 'navy_female') {
            if (isNaN(height) || height <= 0) errors.height = "Altezza richiesta e maggiore di 0 cm";
            if (isNaN(neck) || neck <= 0) errors.neck = "Circonferenza collo richiesta e maggiore di 0 cm";
            if (isNaN(waist) || waist <= 0) errors.waist = "Circonferenza vita richiesta e maggiore di 0 cm";
            if (isNaN(hip) || hip <= 0) errors.hip = "Circonferenza fianchi richiesta e maggiore di 0 cm";
            if (!errors.waist && !errors.hip && !errors.neck && (waist + hip <= neck)) {
                errors.hip = "La somma di vita e fianchi deve essere maggiore del collo";
            }
        } else if (method === 'bmi') {
            if (isNaN(height) || height <= 0) errors.height = "Altezza richiesta e maggiore di 0 cm";
        }
        const isValid = Object.keys(errors).length === 0;
        if (!isValid) {
            return { isValid: false, errors, cleanData: null, bfPercentage: null };
        }
        const bfPercentage = this.calculateBodyFatByMethod(method, {
            bfPercentage: manualBf,
            manualBf,
            weight,
            height,
            neck,
            waist,
            hip,
            age: data.age,
            dob: data.dob,
            gender: data.gender
        });
        if (bfPercentage === null) {
            errors.bfPercentage = "Impossibile calcolare la % di massa grassa con i dati forniti";
            return { isValid: false, errors, cleanData: null, bfPercentage: null };
        }
        const cleanData = {
            date: dateStr,
            weight: Math.round(weight * 10) / 10,
            measurementMethod: method,
            bfPercentage,
            measurements: {
                height: !isNaN(height) && height > 0 ? Math.round(height * 10) / 10 : null,
                neck: !isNaN(neck) && neck > 0 ? Math.round(neck * 10) / 10 : null,
                waist: !isNaN(waist) && waist > 0 ? Math.round(waist * 10) / 10 : null,
                hip: !isNaN(hip) && hip > 0 ? Math.round(hip * 10) / 10 : null,
                manualBf: !isNaN(manualBf) && manualBf >= 0 ? Math.round(manualBf * 10) / 10 : null
            }
        };
        return { isValid: true, errors: {}, cleanData, bfPercentage };
    },
    calculateBodyComposition(weight, bfPercentage) {
        const w = parseFloat(weight);
        const bf = parseFloat(bfPercentage);
        if (isNaN(w) || isNaN(bf) || w <= 0 || bf < 0 || bf > 100) {
            return { fatMass: 0, leanMass: 0 };
        }
        const fatMass = Math.round(w * (bf / 100) * 10) / 10;
        const leanMass = Math.round((w - fatMass) * 10) / 10;
        return { fatMass, leanMass };
    },
    calculateFoodMacros(food, quantity) {
        const scaled = this.scaleFoodNutrients(food, quantity, food ? food.unit : 'g');
        return {
            kcal: scaled.kcal,
            carbs: scaled.carbs,
            pro: scaled.pro,
            fat: scaled.fat,
            satFat: scaled.satFat,
            unSatFat: scaled.unSatFat,
            sugars: scaled.sugars,
            salt: scaled.salt
        };
    },
    scaleFoodNutrients(food, quantity, unit) {
        const zeroed = {
            kcal: 0, carbs: 0, pro: 0, fat: 0,
            satFat: 0, unSatFat: 0, sugars: 0, fiber: 0,
            salt: 0, sodium: 0, vitA: 0, vitC: 0, calcium: 0, iron: 0
        };
        if (!food || isNaN(quantity) || quantity <= 0) {
            return zeroed;
        }
        const qtyNum = parseFloat(quantity);
        const baseQty = parseFloat(food.baseQty || food.defaultQty) || 100;
        let effectiveQty = qtyNum;
        const u = (unit || food.unit || 'g').toString().toLowerCase().trim();
        const servingName = (food.servingUnit || '').toString().toLowerCase().trim();
        if (u === 'pcs' || u === 'pezzo' || (servingName && u === servingName)) {
            const weight = parseFloat(food.servingWeight) || baseQty;
            effectiveQty = qtyNum * weight;
        }
        const factor = effectiveQty / baseQty;
        const scale1 = val => Math.round((parseFloat(val) || 0) * factor * 10) / 10;
        const scale2 = val => Math.round((parseFloat(val) || 0) * factor * 100) / 100;
        return {
            kcal: Math.round((parseFloat(food.kcal) || 0) * factor),
            carbs: scale1(food.carbs),
            pro: scale1(food.pro),
            fat: scale1(food.fat),
            satFat: scale1(food.satFat),
            unSatFat: scale1(food.unSatFat),
            sugars: scale1(food.sugars),
            fiber: scale1(food.fiber),
            salt: scale2(food.salt),
            sodium: scale2(food.sodium),
            vitA: scale2(food.vitA),
            vitC: scale2(food.vitC),
            calcium: scale2(food.calcium),
            iron: scale2(food.iron)
        };
    },
    searchFoods(foodsList, query, categoryFilter) {
        if (!Array.isArray(foodsList)) return [];
        let results = foodsList;
        if (categoryFilter && categoryFilter !== 'all') {
            results = results.filter(item => item && item.category === categoryFilter);
        }
        if (!query || typeof query !== 'string' || !query.trim()) {
            return results;
        }
        const normalize = str => (str || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const q = normalize(query);
        const matched = results.filter(item => {
            if (!item) return false;
            const name = normalize(item.name);
            const category = normalize(item.category);
            const servingUnit = normalize(item.servingUnit);
            const brand = normalize(item.brand);
            return name.includes(q) || category.includes(q) || servingUnit.includes(q) || brand.includes(q);
        });
        return matched.sort((a, b) => {
            const aName = normalize(a.name);
            const bName = normalize(b.name);
            const aStarts = aName.startsWith(q);
            const bStarts = bName.startsWith(q);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName);
        });
    },
    validateCustomFood(foodData) {
        const errors = {};
        if (!foodData || typeof foodData !== 'object') {
            return { isValid: false, errors: { general: "Dati alimento non validi" }, cleanData: null };
        }
        const name = (foodData.name || '').trim();
        if (!name || name.length < 2) {
            errors.name = "Il nome deve contenere almeno 2 caratteri";
        }
        const unit = foodData.unit || 'g';
        if (!['g', 'ml', '1pezzo', 'pezzo', 'pcs'].includes(unit)) {
            errors.unit = "Unità di misura non valida (usare g, ml o pezzo)";
        }
        const baseQty = parseFloat(foodData.baseQty) || 100;
        if (baseQty <= 0) {
            errors.baseQty = "La quantità base deve essere maggiore di 0";
        }
        if (unit === '1pezzo' || unit === 'pezzo' || unit === 'pcs') {
            const pieceWeight = parseFloat(foodData.servingWeight || foodData.pieceWeight);
            if (isNaN(pieceWeight) || pieceWeight <= 0) {
                errors.servingWeight = "Inserire il peso in grammi per la singola porzione";
            }
        }
        const checkNonNegative = (val, fieldName, label) => {
            const num = parseFloat(val);
            if (isNaN(num) || num < 0) {
                errors[fieldName] = `${label} deve essere un numero non negativo`;
                return 0;
            }
            return num;
        };
        const kcal = checkNonNegative(foodData.kcal, 'kcal', 'Calorie');
        const carbs = checkNonNegative(foodData.carbs, 'carbs', 'Carboidrati');
        const pro = checkNonNegative(foodData.pro, 'pro', 'Proteine');
        const fat = checkNonNegative(foodData.fat, 'fat', 'Grassi');
        const satFat = foodData.satFat !== undefined && foodData.satFat !== '' ? checkNonNegative(foodData.satFat, 'satFat', 'Grassi saturi') : 0;
        const unSatFat = foodData.unSatFat !== undefined && foodData.unSatFat !== '' ? checkNonNegative(foodData.unSatFat, 'unSatFat', 'Grassi insaturi') : 0;
        const sugars = foodData.sugars !== undefined && foodData.sugars !== '' ? checkNonNegative(foodData.sugars, 'sugars', 'Zuccheri') : 0;
        const fiber = foodData.fiber !== undefined && foodData.fiber !== '' ? checkNonNegative(foodData.fiber, 'fiber', 'Fibre') : 0;
        const salt = foodData.salt !== undefined && foodData.salt !== '' ? checkNonNegative(foodData.salt, 'salt', 'Sale') : 0;
        const sodium = foodData.sodium !== undefined && foodData.sodium !== '' ? checkNonNegative(foodData.sodium, 'sodium', 'Sodio') : 0;
        const vitA = foodData.vitA !== undefined && foodData.vitA !== '' ? checkNonNegative(foodData.vitA, 'vitA', 'Vitamina A') : 0;
        const vitC = foodData.vitC !== undefined && foodData.vitC !== '' ? checkNonNegative(foodData.vitC, 'vitC', 'Vitamina C') : 0;
        const calcium = foodData.calcium !== undefined && foodData.calcium !== '' ? checkNonNegative(foodData.calcium, 'calcium', 'Calcio') : 0;
        const iron = foodData.iron !== undefined && foodData.iron !== '' ? checkNonNegative(foodData.iron, 'iron', 'Ferro') : 0;
        if (sugars > carbs) {
            errors.sugars = "Gli zuccheri non possono superare i carboidrati totali";
        }
        if (satFat + unSatFat > fat + 0.01) {
            errors.satFat = "La somma dei grassi saturi e insaturi non può superare i grassi totali";
        }
        const isValid = Object.keys(errors).length === 0;
        const cleanData = isValid ? {
            id: foodData.id || `custom_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name,
            brand: (foodData.brand || '').trim(),
            category: foodData.category || 'Personalizzato',
            baseQty,
            unit: unit === '1pezzo' ? 'g' : unit,
            servingUnit: (unit === '1pezzo' || unit === 'pezzo' || unit === 'pcs') ? 'pezzo' : (foodData.servingUnit || null),
            servingWeight: (unit === '1pezzo' || unit === 'pezzo' || unit === 'pcs') ? parseFloat(foodData.servingWeight || foodData.pieceWeight) : (parseFloat(foodData.servingWeight) || null),
            isCustom: true,
            kcal, carbs, pro, fat,
            satFat, unSatFat, sugars, fiber, salt, sodium, vitA, vitC, calcium, iron
        } : null;
        return { isValid, errors, cleanData };
    },
    calculateDailyNutritionSummary(dayMeals, targetPlan) {
        const mealsArray = Array.isArray(dayMeals) ? dayMeals : (dayMeals && typeof dayMeals === 'object' ? Object.values(dayMeals) : []);
        const totals = this.calculateMealTotals(mealsArray);
        const defaultTargets = { kcal: 2500, carbs: 300, pro: 160, fat: 70 };
        const norm = targetPlan && targetPlan.normocalorica ? targetPlan.normocalorica : targetPlan;
        const targets = {
            kcal: parseFloat(norm?.kcal) || defaultTargets.kcal,
            carbs: parseFloat(norm?.carbs) || defaultTargets.carbs,
            pro: parseFloat(norm?.pro) || defaultTargets.pro,
            fat: parseFloat(norm?.fat) || defaultTargets.fat
        };
        const pct = (val, target) => target > 0 ? Math.round((val / target) * 100) : 0;
        const percentages = {
            kcal: pct(totals.kcal, targets.kcal),
            carbs: pct(totals.carbs, targets.carbs),
            pro: pct(totals.pro, targets.pro),
            fat: pct(totals.fat, targets.fat)
        };
        const remaining = {
            kcal: Math.round(targets.kcal - totals.kcal),
            carbs: Math.round((targets.carbs - totals.carbs) * 10) / 10,
            pro: Math.round((targets.pro - totals.pro) * 10) / 10,
            fat: Math.round((targets.fat - totals.fat) * 10) / 10
        };
        return {
            totals,
            targets,
            percentages,
            remaining,
            isOverTarget: totals.kcal > targets.kcal
        };
    },
    calculateMealTotals(meals) {
        if (!Array.isArray(meals)) return { kcal: 0, carbs: 0, pro: 0, fat: 0, satFat: 0, unSatFat: 0, sugars: 0, fiber: 0, salt: 0, sodium: 0, vitA: 0, vitC: 0, calcium: 0, iron: 0 };
        let totals = { kcal: 0, carbs: 0, pro: 0, fat: 0, satFat: 0, unSatFat: 0, sugars: 0, fiber: 0, salt: 0, sodium: 0, vitA: 0, vitC: 0, calcium: 0, iron: 0 };
        meals.forEach(meal => {
            const foods = meal.foods || meal.items || [];
            foods.forEach(f => {
                totals.kcal += parseFloat(f.kcal) || 0;
                totals.carbs += parseFloat(f.carbs) || 0;
                totals.pro += parseFloat(f.pro) || 0;
                totals.fat += parseFloat(f.fat) || 0;
                totals.satFat += parseFloat(f.satFat) || 0;
                totals.unSatFat += parseFloat(f.unSatFat) || 0;
                totals.sugars += parseFloat(f.sugars) || 0;
                totals.fiber += parseFloat(f.fiber) || 0;
                totals.salt += parseFloat(f.salt) || 0;
                totals.sodium += parseFloat(f.sodium) || 0;
                totals.vitA += parseFloat(f.vitA) || 0;
                totals.vitC += parseFloat(f.vitC) || 0;
                totals.calcium += parseFloat(f.calcium) || 0;
                totals.iron += parseFloat(f.iron) || 0;
            });
        });
        totals.kcal = Math.round(totals.kcal);
        totals.carbs = Math.round(totals.carbs * 10) / 10;
        totals.pro = Math.round(totals.pro * 10) / 10;
        totals.fat = Math.round(totals.fat * 10) / 10;
        totals.satFat = Math.round(totals.satFat * 10) / 10;
        totals.unSatFat = Math.round(totals.unSatFat * 10) / 10;
        totals.sugars = Math.round(totals.sugars * 10) / 10;
        totals.fiber = Math.round(totals.fiber * 10) / 10;
        totals.salt = Math.round(totals.salt * 100) / 100;
        totals.sodium = Math.round(totals.sodium * 100) / 100;
        totals.vitA = Math.round(totals.vitA * 100) / 100;
        totals.vitC = Math.round(totals.vitC * 100) / 100;
        totals.calcium = Math.round(totals.calcium * 100) / 100;
        totals.iron = Math.round(totals.iron * 100) / 100;
        return totals;
    },
    filterItems(items, query, searchFields = ['name']) {
        if (!Array.isArray(items)) return [];
        if (!query || typeof query !== 'string' || !query.trim()) return items;
        const q = query.trim().toLowerCase();
        const fields = Array.isArray(searchFields) ? searchFields : [searchFields];
        return items.filter(item => {
            return fields.some(field => {
                const val = item[field];
                return val && val.toString().toLowerCase().includes(q);
            });
        });
    },
    validateWorkoutRatings(mood, pump, fatigue) {
        const checkRating = val => {
            if (val === null || val === undefined || val === '') return null;
            if (typeof val === 'number') {
                return Number.isInteger(val) && val >= 1 && val <= 10 ? val : null;
            }
            if (typeof val === 'string') {
                const trimmed = val.trim();
                if (/^\d+$/.test(trimmed)) {
                    const num = parseInt(trimmed, 10);
                    return num >= 1 && num <= 10 ? num : null;
                }
            }
            return null;
        };
        const m = checkRating(mood);
        const p = checkRating(pump);
        const f = checkRating(fatigue);
        const isValid = m !== null && p !== null && f !== null;
        return {
            isValid,
            mood: m,
            pump: p,
            fatigue: f,
            errors: {
                mood: m === null ? "Voto umore deve essere un intero da 1 a 10" : null,
                pump: p === null ? "Voto pump deve essere un intero da 1 a 10" : null,
                fatigue: f === null ? "Voto stanchezza deve essere un intero da 1 a 10" : null
            }
        };
    },
    getCalendarMonthGrid(year, month) {
        const y = parseInt(year, 10);
        const m = parseInt(month, 10);
        const firstDay = new Date(y, m, 1);
        const startOffset = (firstDay.getDay() + 6) % 7;
        const pad = n => String(n).padStart(2, '0');
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const grid = [];
        let cellCount = 0;
        const lastDayOfMonth = new Date(y, m + 1, 0);
        while (cellCount < 35 || (cellCount % 7 !== 0) || (new Date(y, m, 1 - startOffset + cellCount - 1) < lastDayOfMonth)) {
            const curDate = new Date(y, m, 1 - startOffset + cellCount);
            const curYear = curDate.getFullYear();
            const curMonth = curDate.getMonth();
            const dateStr = `${curYear}-${pad(curMonth + 1)}-${pad(curDate.getDate())}`;
            grid.push({
                dayNum: curDate.getDate(),
                dateStr,
                isCurrentMonth: curMonth === m && curYear === y,
                isToday: dateStr === todayStr
            });
            cellCount++;
        }
        return grid;
    },
    getWorkoutDatesSet(history) {
        const datesSet = new Set();
        if (!Array.isArray(history)) return datesSet;
        history.forEach(item => {
            if (!item) return;
            let dStr = item.date || item.dateStr;
            if (dStr) {
                if (typeof dStr === 'string') {
                    dStr = dStr.split('T')[0].trim();
                } else if (dStr instanceof Date) {
                    const pad = n => String(n).padStart(2, '0');
                    dStr = `${dStr.getFullYear()}-${pad(dStr.getMonth() + 1)}-${pad(dStr.getDate())}`;
                }
                if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
                    datesSet.add(dStr);
                }
            }
        });
        return datesSet;
    },
    filterRoutines(routines, library, query) {
        if (!Array.isArray(routines)) return [];
        if (!query || typeof query !== 'string' || !query.trim()) return routines;
        const q = query.trim().toLowerCase();
        const libMap = new Map();
        if (Array.isArray(library)) {
            library.forEach(ex => {
                if (ex && ex.id) libMap.set(ex.id, ex);
            });
        }
        const muscleNameMap = new Map();
        if (Array.isArray(this.MUSCLES)) {
            this.MUSCLES.forEach(m => {
                if (m && m.id) muscleNameMap.set(m.id, (m.name || '').toLowerCase());
            });
        }
        return routines.filter(routine => {
            if (!routine) return false;
            if (routine.name && routine.name.toLowerCase().includes(q)) return true;
            if (routine.description && routine.description.toLowerCase().includes(q)) return true;
            if (Array.isArray(routine.targetMuscles)) {
                const matchTarget = routine.targetMuscles.some(mId => {
                    const mName = muscleNameMap.get(mId) || '';
                    return mId.toLowerCase().includes(q) || mName.includes(q);
                });
                if (matchTarget) return true;
            }
            if (Array.isArray(routine.exercises)) {
                for (const re of routine.exercises) {
                    if (!re) continue;
                    let ex = null;
                    if (typeof re === 'string') {
                        ex = libMap.get(re);
                    } else if (typeof re === 'object') {
                        ex = libMap.get(re.id) || libMap.get(re.exerciseId) || re;
                    }
                    if (ex) {
                        if (ex.name && ex.name.toLowerCase().includes(q)) return true;
                        if (Array.isArray(ex.muscles)) {
                            const matchExMuscle = ex.muscles.some(mId => {
                                const mName = muscleNameMap.get(mId) || '';
                                return mId.toLowerCase().includes(q) || mName.includes(q);
                            });
                            if (matchExMuscle) return true;
                        }
                    }
                }
            }
            return false;
        });
    }
};
