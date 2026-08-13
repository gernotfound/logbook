import Fuse from 'fuse.js';
import { calculateBodyFat } from './bodyFat';

export function calculateTDEE(nutritionHistoryList: { date?: string; weight?: string | number; kcal?: string | number }[]) {
    if (!Array.isArray(nutritionHistoryList)) {
        return { error: true, message: "Dati non validi" };
    }
    const validDays = nutritionHistoryList.filter((d): d is { date: string; weight: string | number; kcal: string | number } => Boolean(d && d.date && parseFloat(d.weight as any) > 0 && parseFloat(d.kcal as any) > 0));
    if (validDays.length < 7) { 
        return { error: true, message: `Raccolta dati in corso... (${validDays.length}/7 giorni richiesti)` }; 
    }
    const recentDays = validDays.slice(-14); 
    const wLast = parseFloat(recentDays[recentDays.length - 1].weight as any);
    const wFirst = parseFloat(recentDays[0].weight as any);
    const firstDate = new Date(recentDays[0].date);
    const lastDate = new Date(recentDays[recentDays.length - 1].date);
    const diffDays = Math.ceil(Math.abs(lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return { error: true, message: "Dati insufficienti (stesso giorno)" };
    const avgKcal = recentDays.reduce((sum, d) => sum + parseFloat(d.kcal as any), 0) / recentDays.length;
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
}

export function calculateDailyCalories(carbs: any, pro?: any, fat?: any) {
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
}

export function calculateMacrosFromKg(weight: any, carbsPerKg?: any, proPerKg?: any, fatPerKg?: any) {
    let w: number, c: number, p: number, f: number;
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
        return { carbsGrams: 0, proGrams: 0, fatGrams: 0, carbsG: 0, proG: 0, fat: 0, carbsKcal: 0, proKcal: 0, fatKcal: 0, totalKcal: 0 };
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
}

export function calculateMacros(params: any) {
    if (typeof params === 'object' && params !== null && ('weight' in params || 'carbsPerKg' in params)) {
        return calculateMacrosFromKg(params.weight, params.carbsPerKg, params.proPerKg, params.fatPerKg);
    }
    return calculateMacrosFromKg(params);
}

export function calculateMacroRatio(carbsGrams: any, fatGrams: any) {
    const cG = parseFloat(carbsGrams) || 0;
    const fG = parseFloat(fatGrams) || 0;
    const cKcal = cG * 4;
    const fKcal = fG * 9;
    if (fKcal <= 0) return { ratioKcal: cKcal > 0 ? Infinity : 0, ratioGrams: fG > 0 ? Math.round((cG / fG) * 100) / 100 : 0, ratioString: fKcal === 0 ? 'N/A' : '1.0:0' };
    const ratioKcal = Math.round((cKcal / fKcal) * 100) / 100;
    const ratioGrams = Math.round((cG / fG) * 100) / 100;
    return { ratioKcal, ratioGrams, ratioString: `${ratioKcal}:1` };
}

export function modulateMacroRatio(param1: any, param2?: any, param3?: any, param4?: any, param5?: any, param6?: any) {
    let weight: any, carbsPerKg: any, proPerKg: any, fatPerKg: any, lockedMacro: any, targetValue: any, targetType: any;
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
}

export function calculateNormocaloricaDiff(current: any, normocalorica: any) {
    if (!current || !normocalorica) return null;
    const getDiff = (curr: any, norm: any) => {
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
}

export function calculateTDEEAndMacros(state: any) {
    if (!state) return { tdee: 2500, bf: null, carbs: 300, pro: 160, fat: 70, totalKcal: 2500 };
    let tdeeVal = 2500;
    if (state.nutritionPlanning && state.nutritionPlanning.normocalorica && state.nutritionPlanning.normocalorica.kcal) {
        tdeeVal = state.nutritionPlanning.normocalorica.kcal;
    }
    if (state.nutrition && typeof state.nutrition === 'object') {
        const dates = Object.keys(state.nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
        const historyList = dates.map(d => ({ date: d, weight: state.nutrition[d].weight, kcal: state.nutrition[d].kcal }));
        const tdeeRes = calculateTDEE(historyList);
        if (!tdeeRes.error && tdeeRes.tdee) {
            tdeeVal = tdeeRes.tdee;
        }
    }
    const planning = state.nutritionPlanning || { weight: 80, carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 };
    const weight = parseFloat(planning.weight) || 80;
    let bfVal = null;
    if (state.profile) {
        const bfStr = calculateBodyFat(weight, state.profile);
        if (bfStr) bfVal = parseFloat(bfStr as any);
    }
    const macros = calculateMacrosFromKg(weight, planning.carbsPerKg, planning.proPerKg, planning.fatPerKg);
    return {
        tdee: tdeeVal,
        bf: bfVal,
        carbs: macros.carbsGrams,
        pro: macros.proGrams,
        fat: macros.fatGrams,
        totalKcal: macros.totalKcal
    };
}


export function calculateMealTotals(meals: any[]) {
    const totals = {
        kcal: 0, carbs: 0, pro: 0, fat: 0, satFat: 0, unSatFat: 0,
        sugars: 0, fiber: 0, salt: 0, sodium: 0, vitA: 0, vitC: 0, calcium: 0, iron: 0
    };
    if (!Array.isArray(meals)) return totals;
    meals.forEach(m => {
        if (!m || !Array.isArray(m.foods)) return;
        m.foods.forEach((f: any) => {
            if (!f) return;
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
}

export function scaleFoodNutrients(food: any, quantity: any, unit?: any) {
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
    const scale1 = (val: any) => Math.round((parseFloat(val) || 0) * factor * 10) / 10;
    const scale2 = (val: any) => Math.round((parseFloat(val) || 0) * factor * 100) / 100;
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
}

export function calculateFoodMacros(food: any, quantity: any) {
    const scaled = scaleFoodNutrients(food, quantity, food ? food.unit : 'g');
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
}

const normalizeFoodStr = (str: any) => (str || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const FUSE_FOOD_OPTIONS = {
    keys: [
        { name: 'name', weight: 0.6 },
        { name: 'brand', weight: 0.25 },
        { name: 'category', weight: 0.15 }
    ],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2
};

export function searchFoods(foodsList: any[], query: string, categoryFilter?: string) {
    if (!Array.isArray(foodsList) || foodsList.length === 0) return [];
    let results = foodsList;
    if (categoryFilter && categoryFilter !== 'all') {
        results = results.filter(item => item && item.category === categoryFilter);
    }
    if (!query || typeof query !== 'string' || !query.trim()) {
        return results;
    }
    const q = normalizeFoodStr(query);
    if (!q) return results;

    // Direct substring matches
    const directMatched = results.filter(item => {
        if (!item) return false;
        const name = normalizeFoodStr(item.name);
        const category = normalizeFoodStr(item.category);
        const servingUnit = normalizeFoodStr(item.servingUnit || item.unit);
        const brand = normalizeFoodStr(item.brand);
        return name.includes(q) || category.includes(q) || servingUnit.includes(q) || brand.includes(q);
    });

    if (q.length < 2) {
        return directMatched.sort((a, b) => {
            const aName = normalizeFoodStr(a.name);
            const bName = normalizeFoodStr(b.name);
            const aStarts = aName.startsWith(q);
            const bStarts = bName.startsWith(q);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName, 'it');
        });
    }

    // Fuzzy matches with Fuse.js
    const fuse = new Fuse(results, FUSE_FOOD_OPTIONS);

    const tokens = query.trim().split(/\s+/).filter(t => t.length >= 2);
    let fuzzyMatched: any[] = [];
    if (tokens.length > 1) {
        // Find items that match all tokens
        const tokenMatches = tokens.map(tok => new Set(fuse.search(tok).map(r => r.item)));
        const allMatch = results.filter(item => tokenMatches.every(set => set.has(item)));
        const singleMatches = fuse.search(query.trim()).map(res => res.item);
        fuzzyMatched = [...allMatch, ...singleMatches];
    } else {
        fuzzyMatched = fuse.search(query.trim()).map(res => res.item);
    }

    const seen = new Set<any>();
    const merged: any[] = [];
    for (const f of [...directMatched, ...fuzzyMatched]) {
        const key = f.id ?? f.name;
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(f);
        }
    }

    return merged.sort((a, b) => {
        const aName = normalizeFoodStr(a.name);
        const bName = normalizeFoodStr(b.name);
        const aStarts = aName.startsWith(q);
        const bStarts = bName.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aName.localeCompare(bName, 'it');
    });
}

export function validateCustomFood(foodData: any) {
    const errors: Record<string, string> = {};
    if (!foodData || typeof foodData !== 'object') {
        return { isValid: false, errors: { general: "Dati alimento non validi" }, cleanData: null };
    }
    const name = String(foodData.name || '').trim();
    if (!name) errors.name = "Nome alimento obbligatorio";
    const parseReq = (val: any, fieldName: string, label: string) => {
        const num = parseFloat(val);
        if (isNaN(num) || num < 0) {
            errors[fieldName] = `${label} obbligatorio e >= 0`;
            return 0;
        }
        return Math.round(num * 10) / 10;
    };
    const parseOpt = (val: any) => {
        if (val === undefined || val === null || val === '') return null;
        const num = parseFloat(val);
        return isNaN(num) || num < 0 ? null : Math.round(num * 100) / 100;
    };
    const kcal = parseReq(foodData.kcal, 'kcal', 'Calorie');
    const carbs = parseReq(foodData.carbs, 'carbs', 'Carboidrati');
    const pro = parseReq(foodData.pro, 'pro', 'Proteine');
    const fat = parseReq(foodData.fat, 'fat', 'Grassi');
    const baseQty = parseFloat(foodData.baseQty);
    if (isNaN(baseQty) || baseQty <= 0) {
        errors.baseQty = "Porzione base deve essere > 0";
    }
    const isValid = Object.keys(errors).length === 0;
    if (!isValid) {
        return { isValid: false, errors, cleanData: null };
    }
    const cleanData = {
        name,
        brand: String(foodData.brand || '').trim(),
        category: String(foodData.category || 'Altro').trim(),
        baseQty: baseQty || 100,
        unit: String(foodData.unit || 'g').trim(),
        servingUnit: String(foodData.servingUnit || '').trim(),
        servingWeight: parseOpt(foodData.servingWeight),
        kcal: Math.round(kcal),
        carbs,
        pro,
        fat,
        satFat: parseOpt(foodData.satFat),
        unSatFat: parseOpt(foodData.unSatFat),
        sugars: parseOpt(foodData.sugars),
        fiber: parseOpt(foodData.fiber),
        salt: parseOpt(foodData.salt),
        sodium: parseOpt(foodData.sodium),
        vitA: parseOpt(foodData.vitA),
        vitC: parseOpt(foodData.vitC),
        calcium: parseOpt(foodData.calcium),
        iron: parseOpt(foodData.iron)
    };
    return { isValid: true, errors: {}, cleanData };
}

export function generateMockNutrition() {
    return {};
}
