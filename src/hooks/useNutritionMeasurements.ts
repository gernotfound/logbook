import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { useState, useMemo, useRef } from 'react';
import { useDatedDraft } from './useDatedDraft';
import { useLocalToday } from './useLocalToday';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { hasMeasurementData } from '../lib/nutrition/measurementPresence';
import { MEASUREMENT_CLEAR_PATCH, selectMeasurementHistory } from '../lib/nutrition/measurementHistory';
import { parseMeasurementNumber, prepareBodyMeasurements } from '../lib/nutrition/measurementInput';
import type { BodyFatProvenance, NutritionDay, UserProfile } from '../types';

const EMPTY_NUTRITION: Record<string, NutritionDay> = {};
const EMPTY_PROFILE: UserProfile = {};
const EMPTY_MEASUREMENTS_HISTORY: NutritionDay[] = [];

export function useNutritionMeasurements(selectedDate?: string, includeHistory = true) {
    const profile = useAppStore(state => state.userData?.profile || EMPTY_PROFILE);
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);

    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [defaultMeasureTime] = useState(() => new Date().toTimeString().substring(0, 5));
    const saving = useRef(false);
    const todayDateStr = useLocalToday();
    const targetDateStr = selectedDate || editingDate || todayDateStr;
    const targetDayData = nutrition[targetDateStr];
    const field = (name: keyof NutritionDay) => targetDayData?.[name]?.toString() ?? '';
    const draft = useDatedDraft('measurement', targetDateStr, {
        weight: field('weight'), waist: field('waist'), neck: field('neck'), hip: field('hip'),
        chest: field('chest'), shoulders: field('shoulders'), biceps: field('biceps'),
        thighs: field('thighs'), calves: field('calves'), measureTime: field('measurementTime') || defaultMeasureTime
    });
    const { weight, waist, neck, hip, chest, shoulders, biceps, thighs, calves, measureTime } = draft.values;
    const hasExistingData = hasMeasurementData(targetDayData);

    const measurementsHistory = useMemo(() => {
        return includeHistory ? selectMeasurementHistory(nutrition) : EMPTY_MEASUREMENTS_HISTORY;
    }, [nutrition, includeHistory]);

    const handleEditClick = (day: Pick<NutritionDay, 'date'>) => {
        setEditingDate(day.date);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const handleCancelEdit = (): boolean => {
        try {
            if (!draft.clear()) return false;
            setEditingDate(null);
            return true;
        } catch {
            // The shared draft hook reports the storage failure. The editor
            // must stay open until its persisted recovery copy is dealt with.
            return false;
        }
    };
    const handleDeleteMeasurement = async (dateStr: string) => {
        const session = captureSession();
        const submittedDraft = dateStr === targetDateStr ? { ...draft.values } : undefined;
        const confirmed = await useDialogStore.getState().showConfirm(`Sei sicuro di voler eliminare la misurazione del ${Logic.formatItalianDate(dateStr)}?`);
        if (!confirmed || !isCurrentSession(session)) return;
        try {
            await dispatchDurableOperation(dispatchDomainOperation, {
                type: 'nutrition-day.patch',
                date: dateStr,
                patch: MEASUREMENT_CLEAR_PATCH,
            });
        } catch {
            if (isCurrentSession(session)) await showAlert("Errore durante l'eliminazione.");
            return;
        }
        if (submittedDraft && isCurrentSession(session)) {
            try { draft.clear(submittedDraft); }
            catch { /* The shared draft hook exposes storage cleanup failure without misreporting the deletion. */ }
        }
    };

    const calculateAndSave = async (e?: { preventDefault(): void }, calculateBf = false) => {
        if (e) e.preventDefault();
        if (saving.current) return false;
        saving.current = true;
        const session = captureSession();
        const submitted = { ...draft.values };
        try {
            const prepared = prepareBodyMeasurements(submitted);
            if (!prepared.ok) {
                await showAlert(prepared.reason === 'weight'
                    ? 'Inserisci un valore valido per il peso.'
                    : 'Inserisci misure numeriche valide.');
                return false;
            }
            const measurements = prepared.values;
            const height = parseMeasurementNumber(profile.height);
            let bf: number | null = null;
            let bfProvenance: BodyFatProvenance | undefined;

            const calculateUsNavy = async () => {
                if (profile.gender !== 'M' && profile.gender !== 'F') {
                    await showAlert('Imposta il sesso nella sezione Biometria per calcolare la massa grassa.');
                    return false;
                }
                const female = profile.gender === 'F';
                if (!waist || !neck || (female && !hip)) {
                    await showAlert(female
                        ? 'Per il calcolo US Navy inserisci vita, collo e fianchi.'
                        : 'Per il calcolo US Navy inserisci vita e collo.');
                    return false;
                }
                if (height === null || height <= 0) {
                    await showAlert('Imposta la tua altezza nella sezione Biometria per calcolare la massa grassa.');
                    return false;
                }

                const calculatedBf = Logic.calculateBodyFatByMethod(female ? 'navy_female' : 'navy_male', {
                    gender: profile.gender || 'M',
                    height,
                    waist: measurements.waist,
                    neck: measurements.neck,
                    hip: female ? measurements.hip : undefined
                });
                if (calculatedBf === null || !Number.isFinite(calculatedBf)) {
                    await showAlert(female
                        ? 'Impossibile calcolare la massa grassa. Verifica vita, collo e fianchi.'
                        : 'Impossibile calcolare la massa grassa. Verifica che la vita sia maggiore del collo.');
                    return false;
                }
                const calculatedProvenance: BodyFatProvenance = {
                    method: 'us_navy',
                    inputs: {
                        heightCm: height,
                        waistCm: measurements.waist,
                        neckCm: measurements.neck,
                        ...(hip && female ? { hipCm: measurements.hip } : {}),
                        gender: profile.gender || 'M',
                    },
                };
                return { bf: calculatedBf, provenance: calculatedProvenance };
            };

            if (calculateBf) {
                const calculation = await calculateUsNavy();
                if (!calculation) return false;
                bf = calculation.bf;
                bfProvenance = calculation.provenance;
            }
            const targetDate = targetDateStr;
            try {
                if (!isCurrentSession(session)) throw new Error('Sessione cambiata');
                draft.verifyCurrentDraft();
                await dispatchDurableOperation(dispatchDomainOperation, {
                    type: 'nutrition-day.patch',
                    date: targetDate,
                    patch: {
                        weight: measurements.weight,
                        waist: measurements.waist,
                        neck: measurements.neck,
                        hip: profile.gender === 'F' ? measurements.hip : undefined,
                        chest: measurements.chest,
                        shoulders: measurements.shoulders,
                        biceps: measurements.biceps,
                        thighs: measurements.thighs,
                        calves: measurements.calves,
                        bf: bf !== null && !isNaN(bf) ? Math.round(bf * 10) / 10 : undefined,
                        bfProvenance,
                        measurementTime: measureTime,
                    },
                });
                if (!isCurrentSession(session)) return false;
                const cleared = draft.clear(submitted);
                if (cleared && isCurrentSession(session)) setEditingDate(null);
                return cleared;
            } catch {
                if (isCurrentSession(session)) await showAlert("Errore durante il salvataggio della misurazione.");
                return false;
            }
        } finally { saving.current = false; }
    };

    return {
        profile,
        targetDateStr,
        selectedDate,
        editingDate,
        setEditingDate,
        hasExistingData,
        bfProvenance: targetDayData?.bfProvenance as BodyFatProvenance | undefined,
        measureTime, setMeasureTime: (value: string) => draft.setField('measureTime', value),
        weight, setWeight: (value: string) => draft.setField('weight', value),
        waist, setWaist: (value: string) => draft.setField('waist', value),
        neck, setNeck: (value: string) => draft.setField('neck', value),
        hip, setHip: (value: string) => draft.setField('hip', value),
        chest, setChest: (value: string) => draft.setField('chest', value),
        shoulders, setShoulders: (value: string) => draft.setField('shoulders', value),
        biceps, setBiceps: (value: string) => draft.setField('biceps', value),
        thighs, setThighs: (value: string) => draft.setField('thighs', value),
        calves, setCalves: (value: string) => draft.setField('calves', value),
        measurementsHistory,
        handleEditClick,
        handleCancelEdit,
        calculateAndSave,
        handleDeleteMeasurement
    };
}
