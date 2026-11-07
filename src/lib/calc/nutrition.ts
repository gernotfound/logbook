import Fuse from 'fuse.js';
import { calculateBodyFat } from './bodyFat';
import type { UserData } from '../../types';
import { parseDateInput } from '../utils/date';

export function calculateTDEE(nutritionHistoryList: { date?: string; weight?: string | number; kcal?: string | number }[]) {
    if (!Array.isArray(nutritionHistoryList)) {
        return { error: true, message: "Dati non validi" };
    }
    const validDays = nutritionHistoryList.flatMap((d) => {
        if (!d || typeof d.date !== 'string') return [];
        const date = parseDateInput(d.date);
        const w = parseFloat(String(d.weight).replace(',', '.'));
        const k = parseFloat(String(d.kcal).replace(',', '.'));
        if (date !== d.date || !Number.isFinite(w) || w <= 0 || !Number.isFinite(k) || k <= 0) return [];
        return [{ date, weight: d.weight as string | number, kcal: d.kcal as string | number }];
    });

    const dayOrdinal = (date: string) => {
        const [year, month, day] = date.split('-').map(Number);
        return Date.UTC(year, month - 1, day) / (1000 * 60 * 60 * 24);
    };
    // One business day is one observation. Duplicate dates cannot inflate
    // the sample size or bias its average and weight trend.
    const distinctDateCount = new Set(validDays.map(day => day.date)).size;
    if (distinctDateCount < 7) {
        return { error: true, message: `Raccolta dati in corso... (${distinctDateCount}/7 giorni richiesti)` };
    }
    const sortedValidDays = [...validDays].sort((a, b) => dayOrdinal(a.date) - dayOrdinal(b.date));
    // The sample is anchored to the most recent recorded calendar day.
    // Duplicates outside this window cannot invalidate an otherwise valid estimate.
    const latestDay = dayOrdinal(sortedValidDays[sortedValidDays.length - 1].date);
    const recentCandidates = sortedValidDays.filter(d => dayOrdinal(d.date) >= latestDay - 13);
    const recentDistinctCount = new Set(recentCandidates.map(day => day.date)).size;
    if (recentDistinctCount < 7) {
        return { error: true, message: `Dati insufficienti: ${recentDistinctCount}/7 giornate valide negli ultimi 14 giorni.` };
    }
    if (recentDistinctCount !== recentCandidates.length) {
        return { error: true, message: 'Campione non valido: registrazioni duplicate per la stessa giornata.' };
    }
    const recentDays = recentCandidates.slice(-14);
    const wFirst = parseFloat(String(recentDays[0].weight).replace(',', '.'));
    const wLast = parseFloat(String(recentDays[recentDays.length - 1].weight).replace(',', '.'));
    const diffDays = Math.abs(dayOrdinal(recentDays[recentDays.length - 1].date) - dayOrdinal(recentDays[0].date));
    if (diffDays === 0) return { error: true, message: "Dati insufficienti (stesso giorno)" };
    const avgKcal = recentDays.reduce((sum, d) => sum + parseFloat(String(d.kcal).replace(',', '.')), 0) / recentDays.length;
    const weightDiff = wLast - wFirst;
    const dailySurplusKcal = (weightDiff / diffDays) * 7700;
    const estimatedTDEE = avgKcal - dailySurplusKcal;
    if (!Number.isFinite(avgKcal) || !Number.isFinite(weightDiff) || !Number.isFinite(dailySurplusKcal) || !Number.isFinite(estimatedTDEE)) {
        return { error: true, message: "Dati non validi" };
    }
    // Rapid water-weight changes can invalidate the energy-balance estimate.
    // Never present a zero or negative expenditure as a physiological target.
    if (Math.round(estimatedTDEE) <= 0) {
        return { error: true, message: "Stima non attendibile: verifica peso e calorie registrate." };
    }
    return {
        error: false,
        tdee: Math.round(estimatedTDEE),
        avgKcal: Math.round(avgKcal),
        weightDiff: weightDiff.toFixed(2),
        daysTracked: recentDays.length,
        timeSpanDays: diffDays,
        dailyDeficit: Math.round(dailySurplusKcal)
    };
}

export function calculateMacrosFromKg(
    weight: number | string | null | undefined,
    carbsPerKg?: number | string | null,
    proPerKg?: number | string | null,
    fatPerKg?: number | string | null,
) {
    const w = parseFloat(String(weight)) || 0;
    const c = parseFloat(String(carbsPerKg)) || 0;
    const p = parseFloat(String(proPerKg)) || 0;
    const f = parseFloat(String(fatPerKg)) || 0;
    const zeroed = { carbsGrams: 0, proGrams: 0, fatGrams: 0, carbsKcal: 0, proKcal: 0, fatKcal: 0, totalKcal: 0 };
    if (![w, c, p, f].every(Number.isFinite) || w <= 0 || c < 0 || p < 0 || f < 0) {
        return zeroed;
    }
    const carbsGrams = Math.round(w * c * 10) / 10;
    const proGrams = Math.round(w * p * 10) / 10;
    const fatGrams = Math.round(w * f * 10) / 10;
    const carbsKcal = Math.round(carbsGrams * 4);
    const proKcal = Math.round(proGrams * 4);
    const fatKcal = Math.round(fatGrams * 9);
    const totalKcal = carbsKcal + proKcal + fatKcal;
    if (![carbsGrams, proGrams, fatGrams, carbsKcal, proKcal, fatKcal, totalKcal].every(Number.isFinite)) {
        return zeroed;
    }
    return {
        carbsGrams, proGrams, fatGrams,
        carbsKcal, proKcal, fatKcal, totalKcal
    };
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

export function calculateTDEEAndMacros(state: Partial<UserData> | null) {
    if (!state) return { tdee: 2500, bf: null, carbs: 300, pro: 160, fat: 70, totalKcal: 2500 };
    let tdeeVal = 2500;
    if (state.nutritionPlanning && state.nutritionPlanning.normocalorica && state.nutritionPlanning.normocalorica.kcal) {
        tdeeVal = state.nutritionPlanning.normocalorica.kcal;
    }
    const nutrition = state.nutrition;
    if (nutrition && typeof nutrition === 'object') {
        const dates = Object.keys(nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
        const historyList = dates.map(d => ({ date: d, weight: nutrition[d].weight, kcal: nutrition[d].kcal }));
        const tdeeRes = calculateTDEE(historyList);
        if (!tdeeRes.error && tdeeRes.tdee) {
            tdeeVal = tdeeRes.tdee;
        }
    }
    const planning = state.nutritionPlanning;
    const weight = Number(planning?.weight) || 80;
    let bfVal = null;
    if (state.profile) {
        const bfStr = calculateBodyFat(weight, state.profile);
        if (bfStr) bfVal = Number(bfStr);
    }
    const macros = calculateMacrosFromKg(
        weight,
        planning?.avgMacros?.carbsPerKg ?? 3.5,
        planning?.avgMacros?.proPerKg ?? 2.0,
        planning?.avgMacros?.fatPerKg ?? 1.0
    );
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

const normalizeFoodStr = (str: unknown): string => String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

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

/** Keep all food metadata and caller-specific fields intact through filtering. */
interface SearchableFood {
    id?: string | number;
    name: string;
    brand?: string;
    category?: string;
    servingUnit?: string;
    unit?: string;
}

export function createFoodSearcher<T extends SearchableFood>(foodsList: T[], categoryFilter?: string): (query: string) => T[] {
    if (!Array.isArray(foodsList) || foodsList.length === 0) return () => [];
    let results = foodsList;
    if (categoryFilter && categoryFilter !== 'all') {
        results = results.filter(item => item && item.category === categoryFilter);
    }
    type PreparedFood = { item: T; name: string; category: string; servingUnit: string; brand: string } | null;
    let prepared: PreparedFood[] | undefined;
    const normalizedNames = new Map<T, string>();
    let fuse: Fuse<T> | undefined;
    const nameOf = (item: T) => normalizedNames.get(item) ?? normalizeFoodStr(item.name);
    return (query: string): T[] => {
        if (!query || typeof query !== 'string' || !query.trim()) {
            return results;
        }
        const q = normalizeFoodStr(query);
        if (!q) return results;

        if (!prepared) {
            prepared = results.map(item => item ? {
                item,
                name: normalizeFoodStr(item.name),
                category: normalizeFoodStr(item.category),
                servingUnit: normalizeFoodStr(item.servingUnit || item.unit),
                brand: normalizeFoodStr(item.brand)
            } : null);
            for (const entry of prepared) {
                if (entry) normalizedNames.set(entry.item, entry.name);
            }
        }

        // Direct substring matches
        const directMatched: T[] = [];
        for (const entry of prepared) {
            if (entry && (entry.name.includes(q) || entry.category.includes(q)
                || entry.servingUnit.includes(q) || entry.brand.includes(q))) {
                directMatched.push(entry.item);
            }
        }

        if (q.length < 2) {
            return directMatched.sort((a, b) => {
                const aName = nameOf(a);
                const bName = nameOf(b);
                const aStarts = aName.startsWith(q);
                const bStarts = bName.startsWith(q);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return aName.localeCompare(bName, 'it');
            });
        }

        // Build Fuse only if the query actually needs fuzzy matching.
        const currentFuse = fuse ?? (fuse = new Fuse(results, FUSE_FOOD_OPTIONS));

        const tokens = query.trim().split(/\s+/).filter(t => t.length >= 2);
        let fuzzyMatched: T[] = [];
        if (tokens.length > 1) {
            // Find items that match all tokens
            const tokenMatches = tokens.map(tok => new Set(currentFuse.search(tok).map(r => r.item)));
            const allMatch = results.filter(item => tokenMatches.every(set => set.has(item)));
            const singleMatches = currentFuse.search(query.trim()).map(res => res.item);
            fuzzyMatched = [...allMatch, ...singleMatches];
        } else {
            fuzzyMatched = currentFuse.search(query.trim()).map(res => res.item);
        }

        const seen = new Set<string | number>();
        const merged: T[] = [];
        for (const f of [...directMatched, ...fuzzyMatched]) {
            const key = f.id ?? f.name;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(f);
            }
        }

        return merged.sort((a, b) => {
            const aName = nameOf(a);
            const bName = nameOf(b);
            const aStarts = aName.startsWith(q);
            const bStarts = bName.startsWith(q);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName, 'it');
        });
    };
}

export function searchFoods<T extends SearchableFood>(foodsList: T[], query: string, categoryFilter?: string): T[] {
    return createFoodSearcher(foodsList, categoryFilter)(query);
}

export function validateCustomFood(foodData: any) {
    const errors: Record<string, string> = {};
    if (!foodData || typeof foodData !== 'object') {
        return { isValid: false, errors: { general: "Dati alimento non validi" }, cleanData: null };
    }
    const name = String(foodData.name || '').trim();
    if (!name) errors.name = "Nome alimento obbligatorio";

    // Input from editable fields must be entirely numeric: parseFloat accepts trailing garbage.
    const parseNumeric = (value: unknown): number | null => {
        if (typeof value !== 'number' && typeof value !== 'string') return null;
        const normalized = String(value).trim().replace(',', '.');
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null;
        const numeric = Number(normalized);
        return Number.isFinite(numeric) ? numeric : null;
    };
    const parseReq = (val: unknown, fieldName: string, label: string) => {
        const num = parseNumeric(val);
        const rounded = num === null ? null : Math.round(num * 10) / 10;
        if (num === null || num < 0 || rounded === null || !Number.isFinite(rounded)) {
            errors[fieldName] = `${label} obbligatorio e >= 0`;
            return 0;
        }
        return rounded;
    };
    const parseOpt = (val: unknown) => {
        if (val === undefined || val === null || val === '') return null;
        const num = parseNumeric(val);
        if (num === null || num < 0) return null;
        const rounded = Math.round(num * 100) / 100;
        return Number.isFinite(rounded) ? rounded : null;
    };
    const kcal = parseReq(foodData.kcal, 'kcal', 'Calorie');
    const carbs = parseReq(foodData.carbs, 'carbs', 'Carboidrati');
    const pro = parseReq(foodData.pro, 'pro', 'Proteine');
    const fat = parseReq(foodData.fat, 'fat', 'Grassi');
    const baseQty = parseNumeric(foodData.baseQty);
    if (baseQty === null || baseQty <= 0) {
        errors.baseQty = "Porzione base deve essere > 0";
    }
    const unit = String(foodData.unit || 'g').trim();
    const servingWeight = parseOpt(foodData.servingWeight);
    if ((unit === 'pezzo' || unit === 'pcs') && (servingWeight === null || servingWeight <= 0)) {
        errors.servingWeight = "Il peso di un pezzo deve essere maggiore di 0 g";
    }
    if (Object.keys(errors).length > 0) {
        return { isValid: false, errors, cleanData: null };
    }
    const cleanData = {
        name,
        brand: String(foodData.brand || '').trim(),
        category: String(foodData.category || 'Altro').trim(),
        baseQty: baseQty ?? 100,
        unit,
        servingUnit: String(foodData.servingUnit || '').trim(),
        servingWeight,
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
