import { useState, useMemo, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import type { NutritionPlanning } from '../types';
import { normalizeOnDaysCount } from '../lib/nutritionDefaults';

type EditableNumber = string | number;
type MacroRatioDraft = Record<'carbsPerKg' | 'proPerKg' | 'fatPerKg', EditableNumber>;
type MacroBoostDraft = Record<'carbsPercent' | 'proPercent' | 'fatPercent', EditableNumber>;
type NutritionPlanningDraft = Omit<NutritionPlanning, 'weight' | 'onDaysCount' | 'avgMacros' | 'onBoost' | 'normocalorica'> & {
    weight?: EditableNumber;
    onDaysCount?: EditableNumber;
    avgMacros?: MacroRatioDraft;
    onBoost?: MacroBoostDraft;
    normocalorica?: Partial<Record<'kcal' | 'carbs' | 'pro' | 'fat', EditableNumber>>;
};
type PlanningSaveStatus = 'unsaved' | 'saving' | 'saved' | 'local-pending' | 'error' | null;

function numericInput(value: unknown, fallback = 0): number {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function deriveMacroSplit(avgValue: unknown, boostPercentValue: unknown, onDaysCount: unknown) {
    const avg = numericInput(avgValue);
    const boostPercent = numericInput(boostPercentValue);
    const onDays = normalizeOnDaysCount(onDaysCount);
    if (!Number.isFinite(avg) || avg < 0 || !Number.isFinite(boostPercent) || boostPercent < -100) {
        return { on: 0, off: 0, valid: false };
    }

    if (onDays === 0 || onDays === 7) {
        return { on: avg, off: avg, valid: true };
    }

    const offDays = 7 - onDays;
    const multiplier = 1 + (boostPercent / 100);
    const denominator = (onDays * multiplier) + offDays;
    if (!Number.isFinite(multiplier) || multiplier < 0 || !Number.isFinite(denominator) || denominator <= 0) {
        return { on: 0, off: 0, valid: false };
    }

    const off = (7 * avg) / denominator;
    const on = off * multiplier;
    if (!Number.isFinite(on) || on < 0 || !Number.isFinite(off) || off < 0) {
        return { on: 0, off: 0, valid: false };
    }
    return { on, off, valid: true };
}

export function useNutritionPlanning() {
    const storePlanning = useAppStore(state => state.userData?.nutritionPlanning);
    const nutritionMap = useAppStore(state => state.userData?.nutrition);
    const profile = useAppStore(state => state.userData?.profile);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);

    // Text inputs may temporarily contain an empty string. These are drafts, never business data.
    const [localPlanning, setLocalPlanning] = useState<NutritionPlanningDraft | null>(null);
    const [saveStatus, setSaveStatus] = useState<PlanningSaveStatus>(null);
    const draftRevision = useRef(0);
    const saving = useRef(false);

    let latestWeight = 80;
    if (nutritionMap) {
        const dates = Object.keys(nutritionMap).sort((a, b) => b.localeCompare(a));
        for (const d of dates) {
            if (nutritionMap[d].weight) {
                latestWeight = parseFloat(String(nutritionMap[d].weight)) || latestWeight;
                break;
            }
        }
    }

    const defaultPlanning: NutritionPlanningDraft = {
        weight: latestWeight,
        onDaysCount: 4,
        avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
        onBoost: { carbsPercent: 20, proPercent: 0, fatPercent: 0 },
        normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    };

    const basePlanning = localPlanning ?? storePlanning ?? defaultPlanning;
    const planning: NutritionPlanningDraft = {
        ...basePlanning,
        avgMacros: basePlanning.avgMacros ? { ...defaultPlanning.avgMacros, ...basePlanning.avgMacros } : defaultPlanning.avgMacros,
        onBoost: basePlanning.onBoost ? { ...defaultPlanning.onBoost, ...basePlanning.onBoost } : defaultPlanning.onBoost,
        onDaysCount: normalizeOnDaysCount(basePlanning.onDaysCount),
        weight: basePlanning.weight || latestWeight,
        normocalorica: basePlanning.normocalorica ? { ...defaultPlanning.normocalorica, ...basePlanning.normocalorica } : defaultPlanning.normocalorica,
    };

    const avgC = numericInput(planning.avgMacros!.carbsPerKg);
    const avgP = numericInput(planning.avgMacros!.proPerKg);
    const avgF = numericInput(planning.avgMacros!.fatPerKg);
    const carbsSplit = deriveMacroSplit(avgC, planning.onBoost!.carbsPercent, planning.onDaysCount);
    const proteinSplit = deriveMacroSplit(avgP, planning.onBoost!.proPercent, planning.onDaysCount);
    const fatSplit = deriveMacroSplit(avgF, planning.onBoost!.fatPercent, planning.onDaysCount);

    const currentOnMacros = {
        carbsPerKg: carbsSplit.on,
        proPerKg: proteinSplit.on,
        fatPerKg: fatSplit.on,
    };
    const currentOffMacros = {
        carbsPerKg: carbsSplit.off,
        proPerKg: proteinSplit.off,
        fatPerKg: fatSplit.off,
    };

    const w = numericInput(planning.weight, latestWeight);
    const onMacrosCalc = Logic.calculateMacrosFromKg(w, currentOnMacros.carbsPerKg, currentOnMacros.proPerKg, currentOnMacros.fatPerKg);
    const offMacrosCalc = Logic.calculateMacrosFromKg(w, currentOffMacros.carbsPerKg, currentOffMacros.proPerKg, currentOffMacros.fatPerKg);
    const avgMacrosCalc = Logic.calculateMacrosFromKg(w, avgC, avgP, avgF);

    const tdeeUserData = useMemo(() => ({
        nutritionPlanning: storePlanning,
        nutrition: nutritionMap,
        profile: profile
    }), [storePlanning, nutritionMap, profile]);
    const tdeeCalc = useMemo(() => Logic.calculateTDEEAndMacros(tdeeUserData), [tdeeUserData]);

    const handleUpdate = <K extends keyof NutritionPlanningDraft>(field: K, value: NutritionPlanningDraft[K]) => {
        draftRevision.current += 1;
        setSaveStatus('unsaved');
        setLocalPlanning({ ...planning, [field]: value });
    };

    const handleUpdateAvgMacros = (field: keyof MacroRatioDraft, value: string) => {
        draftRevision.current += 1;
        setSaveStatus('unsaved');
        setLocalPlanning({
            ...planning,
            avgMacros: { ...planning.avgMacros!, [field]: value === '' ? '' : Number(value) }
        });
    };

    const handleUpdateOnBoost = (field: keyof MacroBoostDraft, value: string) => {
        draftRevision.current += 1;
        setSaveStatus('unsaved');
        setLocalPlanning({
            ...planning,
            onBoost: { ...planning.onBoost!, [field]: value === '' ? '' : Number(value) }
        });
    };

    const handleSave = async (e?: { preventDefault: () => void }) => {
        if (e) e.preventDefault();

        const weight = numericInput(planning.weight, latestWeight);
        const avgMacros = {
            carbsPerKg: numericInput(planning.avgMacros!.carbsPerKg),
            proPerKg: numericInput(planning.avgMacros!.proPerKg),
            fatPerKg: numericInput(planning.avgMacros!.fatPerKg),
        };
        const onBoost = {
            carbsPercent: numericInput(planning.onBoost!.carbsPercent),
            proPercent: numericInput(planning.onBoost!.proPercent),
            fatPercent: numericInput(planning.onBoost!.fatPercent),
        };
        const sanitizedNormo = {
            kcal: numericInput(planning.normocalorica?.kcal),
            carbs: numericInput(planning.normocalorica?.carbs),
            pro: numericInput(planning.normocalorica?.pro),
            fat: numericInput(planning.normocalorica?.fat),
        };

        const nonNegativeValues = [
            ...Object.values(avgMacros),
            ...Object.values(sanitizedNormo),
        ];
        const boostValues = Object.values(onBoost);
        const splitValues = [
            ...Object.values(currentOnMacros),
            ...Object.values(currentOffMacros),
        ];
        const invalid = !Number.isFinite(weight)
            || weight <= 0
            || nonNegativeValues.some(value => !Number.isFinite(value) || value < 0)
            || boostValues.some(value => !Number.isFinite(value) || value < -100)
            || !carbsSplit.valid
            || !proteinSplit.valid
            || !fatSplit.valid
            || splitValues.some(value => !Number.isFinite(value) || value < 0);

        if (invalid) {
            await showAlert('Controlla i valori della pianificazione: usa numeri validi, macro non negativi e variazioni ON non inferiori a -100%.');
            return;
        }

        const updatedPlanning: NutritionPlanning = {
            ...planning,
            weight,
            onDaysCount: normalizeOnDaysCount(planning.onDaysCount),
            normocalorica: sanitizedNormo,
            avgMacros,
            onBoost,
            onMacros: currentOnMacros,
            offMacros: currentOffMacros
        };

        if (saving.current) return;
        saving.current = true;
        const submittedRevision = draftRevision.current;
        setSaveStatus('saving');
        try {
            const result = await dispatchDomainOperation({
                type: 'nutrition-planning.replace',
                value: updatedPlanning,
                origin: 'user-edited',
            });
            if (!result.ok && result.status !== 'local-pending') {
                throw new Error('Salvataggio non confermato');
            }
            if (draftRevision.current === submittedRevision) {
                setLocalPlanning(null);
                setSaveStatus(result.status === 'local-pending' ? 'local-pending' : 'saved');
            }
        } catch {
            if (draftRevision.current === submittedRevision) setSaveStatus('error');
            await showAlert("Errore durante il salvataggio della pianificazione. Le modifiche restano nella schermata, ma non sono salvate.");
        } finally {
            saving.current = false;
        }
    };

    return {
        planning,
        onMacrosCalc, offMacrosCalc, avgMacrosCalc, tdeeCalc,
        currentOnMacros, currentOffMacros,
        handleUpdate, handleUpdateAvgMacros, handleUpdateOnBoost, handleSave, saveStatus
    };
}
