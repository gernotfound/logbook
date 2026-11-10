import Fuse from 'fuse.js';
import { calculateBodyFat } from './bodyFat';
import type { UserData } from '../../types';
import { parseDateInput } from '../utils/date';

// Require complete numeric input: parseFloat incorrectly accepts strings with
// units or suffixes. Callers independently enforce positivity and optionality.
function parseFiniteNumericInput(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const normalized = String(value).trim().replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

export function calculateTDEE(nutritionHistoryList: { date?: string; weight?: string | number; kcal?: string | number }[]) {
    if (!Array.isArray(nutritionHistoryList)) {
        return { error: true, message: "Dati non validi" };
    }
    const parsePositiveMeasurement = (value: string | number | undefined): number | null => {
        const parsed = parseFiniteNumericInput(value);
        return parsed !== null && parsed > 0 ? parsed : null;
    };
    const validDays = nutritionHistoryList.flatMap((d) => {
        if (!d || typeof d.date !== 'string') return [];
        const date = parseDateInput(d.date);
        const weight = parsePositiveMeasurement(d.weight);
        const kcal = parsePositiveMeasurement(d.kcal);
        if (date !== d.date || weight === null || kcal === null) return [];
        return [{ date, weight, kcal }];
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
    const wFirst = recentDays[0].weight;
    const wLast = recentDays[recentDays.length - 1].weight;
    const diffDays = Math.abs(dayOrdinal(recentDays[recentDays.length - 1].date) - dayOrdinal(recentDays[0].date));
    if (diffDays === 0) return { error: true, message: "Dati insufficienti (stesso giorno)" };
    const avgKcal = recentDays.reduce((sum, d) => sum + d.kcal, 0) / recentDays.length;
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

export function calculateTDEEAndMacros(state: Partial<UserData> | null) {
    if (!state) return { tdee: 2500, bf: null, carbs: 300, pro: 160, fat: 70, totalKcal: 2500 };
    let tdeeVal = 2500;
    if (state.nutritionPlanning && state.nutritionPlanning.normocalorica && state.nutritionPlanning.normocalorica.kcal) {
        tdeeVal = state.nutritionPlanning.normocalorica.kcal;
    }
    const nutrition = state.nutrition;
    if (nutrition && typeof nutrition === 'object') {
        // calculateTDEE validates and sorts canonical dates; an earlier sort would only duplicate that work.
        const historyList = Object.keys(nutrition).map(d => ({ date: d, weight: nutrition[d].weight, kcal: nutrition[d].kcal }));
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
    const sortMatches = (items: T[], q: string, maxResults?: number): T[] => {
        const compare = (a: T, b: T): number => {
            const aName = nameOf(a);
            const bName = nameOf(b);
            const aStarts = aName.startsWith(q);
            const bStarts = bName.startsWith(q);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName, 'it');
        };
        if (!maxResults || !Number.isSafeInteger(maxResults) || maxResults < 1 || items.length <= maxResults) {
            return items.sort(compare);
        }
        // Insertion after equal-ranked entries retains the same stable order as a full sort.
        const top: T[] = [];
        for (const item of items) {
            let low = 0;
            let high = top.length;
            while (low < high) {
                const mid = Math.floor((low + high) / 2);
                if (compare(item, top[mid]) < 0) high = mid;
                else low = mid + 1;
            }
            if (low >= maxResults) continue;
            top.splice(low, 0, item);
            if (top.length > maxResults) top.pop();
        }
        return top;
    };
    return (query: string, maxResults?: number): T[] => {
        if (!query || typeof query !== 'string' || !query.trim()) {
            return maxResults ? results.slice(0, maxResults) : results;
        }
        const q = normalizeFoodStr(query);
        if (!q) return maxResults ? results.slice(0, maxResults) : results;

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
            return sortMatches(directMatched, q, maxResults);
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

        return sortMatches(merged, q, maxResults);
    };
}

export function validateCustomFood(foodData: any) {
    const errors: Record<string, string> = {};
    if (!foodData || typeof foodData !== 'object') {
        return { isValid: false, errors: { general: "Dati alimento non validi" }, cleanData: null };
    }
    const name = String(foodData.name || '').trim();
    if (!name) errors.name = "Nome alimento obbligatorio";

    const parseReq = (val: unknown, fieldName: string, label: string) => {
        const num = parseFiniteNumericInput(val);
        const rounded = num === null ? null : Math.round(num * 10) / 10;
        if (num === null || num < 0 || rounded === null || !Number.isFinite(rounded)) {
            errors[fieldName] = `${label} obbligatorio e >= 0`;
            return 0;
        }
        return rounded;
    };
    const parseOpt = (val: unknown, field: string, label: string) => {
        if (val === undefined || val === null || val === '') return null;
        const num = parseFiniteNumericInput(val);
        const rounded = num === null ? null : Math.round(num * 100) / 100;
        if (num === null || num < 0 || rounded === null || !Number.isFinite(rounded)) {
            // A blank optional field may be omitted. A malformed supplied value
            // must not silently disappear from a durable custom-food write.
            errors[field] = `${label} deve essere un numero finito >= 0`;
            return null;
        }
        return rounded;
    };
    const kcal = parseReq(foodData.kcal, 'kcal', 'Calorie');
    const carbs = parseReq(foodData.carbs, 'carbs', 'Carboidrati');
    const pro = parseReq(foodData.pro, 'pro', 'Proteine');
    const fat = parseReq(foodData.fat, 'fat', 'Grassi');
    const baseQty = parseFiniteNumericInput(foodData.baseQty);
    if (baseQty === null || baseQty <= 0) {
        errors.baseQty = "Porzione base deve essere > 0";
    }
    const unit = String(foodData.unit || 'g').trim();
    const servingWeight = parseOpt(foodData.servingWeight, 'servingWeight', 'Peso porzione');
    if ((unit === 'pezzo' || unit === 'pcs') && (servingWeight === null || servingWeight <= 0)) {
        errors.servingWeight = "Il peso di un pezzo deve essere maggiore di 0 g";
    }
    const optionalNutrients = {
        satFat: parseOpt(foodData.satFat, 'satFat', 'Grassi saturi'),
        unSatFat: parseOpt(foodData.unSatFat, 'unSatFat', 'Grassi insaturi'),
        sugars: parseOpt(foodData.sugars, 'sugars', 'Zuccheri'),
        fiber: parseOpt(foodData.fiber, 'fiber', 'Fibre'),
        salt: parseOpt(foodData.salt, 'salt', 'Sale'),
        sodium: parseOpt(foodData.sodium, 'sodium', 'Sodio'),
        vitA: parseOpt(foodData.vitA, 'vitA', 'Vitamina A'),
        vitC: parseOpt(foodData.vitC, 'vitC', 'Vitamina C'),
        calcium: parseOpt(foodData.calcium, 'calcium', 'Calcio'),
        iron: parseOpt(foodData.iron, 'iron', 'Ferro'),
    };
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
        ...optionalNutrients
    };
    return { isValid: true, errors: {}, cleanData };
}
