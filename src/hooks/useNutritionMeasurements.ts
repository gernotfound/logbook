import { useState, useMemo, useRef } from 'react';
import { useDatedDraft } from './useDatedDraft';
import { useLocalToday } from './useLocalToday';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import type { BodyFatProvenance } from '../types';

const EMPTY_NUTRITION = {};
const EMPTY_PROFILE = {};

export type BodyFatMode = 'manual' | 'calculate';

export function useNutritionMeasurements(selectedDate?: string) {
    const profile: any = useAppStore(state => state.userData?.profile || EMPTY_PROFILE);
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);

    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [defaultMeasureTime] = useState(() => new Date().toTimeString().substring(0, 5));
    const saving = useRef(false);
    const todayDateStr = useLocalToday();
    const targetDateStr = selectedDate || editingDate || todayDateStr;
    const targetDayData = (nutrition as any)[targetDateStr];
    const field = (name: string) => targetDayData?.[name]?.toString() ?? '';
    const draft = useDatedDraft('measurement', targetDateStr, {
        weight: field('weight'), waist: field('waist'), neck: field('neck'), hip: field('hip'),
        manualBf: targetDayData?.bfProvenance?.method === 'manual' || (targetDayData?.bf != null && !targetDayData?.bfProvenance) ? field('bf') : '',
        chest: field('chest'), shoulders: field('shoulders'), biceps: field('biceps'),
        thighs: field('thighs'), calves: field('calves'), measureTime: field('measurementTime') || defaultMeasureTime
    });
    const { weight, waist, neck, hip, manualBf, chest, shoulders, biceps, thighs, calves, measureTime } = draft.values;
    const hasExistingData = Boolean(
        targetDayData && (
            (targetDayData.weight !== undefined && targetDayData.weight !== null && targetDayData.weight !== '') ||
            (targetDayData.bf !== undefined && targetDayData.bf !== null && targetDayData.bf !== '') ||
            (targetDayData.waist !== undefined && targetDayData.waist !== null && targetDayData.waist !== '') ||
            (targetDayData.neck !== undefined && targetDayData.neck !== null && targetDayData.neck !== '') ||
            (targetDayData.hip !== undefined && targetDayData.hip !== null && targetDayData.hip !== '') ||
            (targetDayData.chest !== undefined && targetDayData.chest !== null && targetDayData.chest !== '') ||
            (targetDayData.shoulders !== undefined && targetDayData.shoulders !== null && targetDayData.shoulders !== '') ||
            (targetDayData.biceps !== undefined && targetDayData.biceps !== null && targetDayData.biceps !== '') ||
            (targetDayData.thighs !== undefined && targetDayData.thighs !== null && targetDayData.thighs !== '') ||
            (targetDayData.calves !== undefined && targetDayData.calves !== null && targetDayData.calves !== '')
        )
    );

    const measurementsHistory = useMemo(() => {
        const historyFields = [
            'weight', 'bf', 'waist', 'neck', 'hip', 'chest', 'shoulders', 'biceps', 'thighs', 'calves',
            'sleepHours', 'sleepDeep', 'sleepLight', 'sleepRem', 'sleepAwake',
        ];
        return Object.values(nutrition)
            .filter((day: any) => day && historyFields.some(key => day[key] !== undefined && day[key] !== null && day[key] !== ''))
            .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
    }, [nutrition]);

    const handleEditClick = (day: any) => {
        setEditingDate(day.date);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const handleCancelEdit = () => {
        try { draft.clear(); setEditingDate(null); }
        catch { /* The storage error is exposed by the shared draft hook. */ }
    };
    const handleDeleteMeasurement = async (dateStr: string) => {
        const session = captureSession();
        const submittedDraft = dateStr === targetDateStr ? { ...draft.values } : undefined;
        const confirmed = await useDialogStore.getState().showConfirm(`Sei sicuro di voler eliminare la misurazione del ${Logic.formatItalianDate ? Logic.formatItalianDate(dateStr) : dateStr}?`);
        if (!confirmed || !isCurrentSession(session)) return;
        try {
            await dispatchDomainOperation({
                type: 'nutrition-day.patch',
                date: dateStr,
                patch: {
                    weight: undefined,
                    bf: undefined,
                    bfProvenance: undefined,
                    waist: undefined,
                    neck: undefined,
                    hip: undefined,
                    chest: undefined,
                    shoulders: undefined,
                    biceps: undefined,
                    thighs: undefined,
                    calves: undefined,
                    measurementTime: undefined,
                },
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

    const calculateAndSave = async (e?: any, bodyFatMode?: BodyFatMode) => {
        if (e) e.preventDefault();
        if (saving.current) return false;
        saving.current = true;
        const session = captureSession();
        const submitted = { ...draft.values };
        try {
            if (!weight.trim() || !Number.isFinite(Number(weight)) || Number(weight) <= 0) {
                await showAlert("Inserisci un valore valido per il peso.");
                return;
            }

            const optional = [waist, neck, hip, chest, shoulders, biceps, thighs, calves];
            if (optional.some(value => value !== '' && (!Number.isFinite(Number(value)) || Number(value) <= 0)) ||
                (bodyFatMode !== 'calculate' && manualBf !== '' && (!Number.isFinite(Number(manualBf)) || Number(manualBf) < 0 || Number(manualBf) > 100))) {
                await showAlert('Inserisci misure numeriche valide e una percentuale di massa grassa tra 0 e 100.');
                return false;
            }
            const height = Number(profile.height);
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
                if (!Number.isFinite(height) || height <= 0) {
                    await showAlert('Imposta la tua altezza nella sezione Biometria per calcolare la massa grassa.');
                    return false;
                }

                bf = Logic.calculateBodyFatByMethod(female ? 'navy_female' : 'navy_male', {
                    gender: profile.gender || 'M',
                    height,
                    weight: Number(weight),
                    waist: Number(waist),
                    neck: Number(neck),
                    hip: hip ? Number(hip) : undefined
                });
                if (bf === null || !Number.isFinite(bf)) {
                    await showAlert(female
                        ? 'Impossibile calcolare la massa grassa. Verifica vita, collo e fianchi.'
                        : 'Impossibile calcolare la massa grassa. Verifica che la vita sia maggiore del collo.');
                    return false;
                }
                bfProvenance = {
                    method: 'us_navy',
                    inputs: {
                        heightCm: height,
                        waistCm: Number(waist),
                        neckCm: Number(neck),
                        ...(hip && female ? { hipCm: Number(hip) } : {}),
                        gender: profile.gender || 'M',
                    },
                };
                return true;
            };

            if (bodyFatMode === 'manual') {
                if (manualBf && !isNaN(Number(manualBf))) {
                    bf = Number(manualBf);
                    bfProvenance = { method: 'manual' };
                }
            } else if (bodyFatMode === 'calculate') {
                if (!(await calculateUsNavy())) return false;
            } else if (manualBf && !isNaN(Number(manualBf))) {
                bf = Number(manualBf);
                bfProvenance = { method: 'manual' };
            } else if (targetDayData?.bf !== undefined && targetDayData?.bf !== null && !targetDayData?.bfProvenance) {
                const legacyBf = Number(targetDayData.bf);
                if (Number.isFinite(legacyBf)) bf = legacyBf;
            } else if (waist && neck && !isNaN(Number(waist)) && !isNaN(Number(neck))) {
                if (!(await calculateUsNavy())) return false;
            }

            const targetDate = targetDateStr;
            try {
                if (!isCurrentSession(session)) throw new Error('Sessione cambiata');
                await dispatchDomainOperation({
                    type: 'nutrition-day.patch',
                    date: targetDate,
                    patch: {
                        weight: Number(weight),
                        waist: waist ? Number(waist) : undefined,
                        neck: neck ? Number(neck) : undefined,
                        hip: hip && profile.gender === 'F' ? Number(hip) : undefined,
                        chest: chest ? Number(chest) : undefined,
                        shoulders: shoulders ? Number(shoulders) : undefined,
                        biceps: biceps ? Number(biceps) : undefined,
                        thighs: thighs ? Number(thighs) : undefined,
                        calves: calves ? Number(calves) : undefined,
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
        manualBf, setManualBf: (value: string) => draft.setField('manualBf', value),
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
