import type { TrainingCycleIntent } from '../../types';
import type { ProgressionClassification, NormalizedExposure, ProgressionQuality, ExerciseProgressionAnalysis } from './progression';

export function formatProgressionReference(exposure?: NormalizedExposure): string {
    const set = exposure?.referenceSet;
    if (!set) return 'dati insufficienti';
    if (exposure?.trackingType === 'time') {
        const main = set.timeSeconds !== undefined && set.timeSeconds > 0 ? `${set.timeSeconds}s` : '';
        const segments = set.segments.length
            ? `segmenti ${set.segments.map(segment => segment.timeSeconds !== undefined && segment.timeSeconds > 0 ? `${segment.timeSeconds}s` : '?').join(' + ')}`
            : '';
        return [main, segments].filter(Boolean).join(' · ') || 'tempo non disponibile';
    }
    const load = set.effectiveKg ?? set.kg;
    const output = `${load !== undefined ? load : '?'} kg × ${set.reps ?? '?'}`;
    return set.rir === undefined ? output : `${output} · RIR ${set.rir}`;
}

export function describe(
    classification: ProgressionClassification,
    current: NormalizedExposure,
    previous?: NormalizedExposure,
): { headline: string; detail: string } {
    const currentRef = formatProgressionReference(current);
    const previousRef = formatProgressionReference(previous);
    switch (classification) {
        case 'performance_record':
            return { headline: 'Record nelle condizioni confrontabili', detail: `${previousRef} → ${currentRef}, migliore delle esposizioni storiche direttamente confrontabili.` };
        case 'output_up_effort_up':
            return { headline: 'Output aumentato con effort maggiore', detail: `${previousRef} → ${currentRef}. L'output è salito insieme all'effort dichiarato.` };
        case 'progression':
            return { headline: 'Progressione osservata', detail: `${previousRef} → ${currentRef}.` };
        case 'stable_less_effort':
            return { headline: 'Output stabile, effort minore', detail: `${currentRef}. Stesso output con RIR dichiarato più alto.` };
        case 'stable_more_effort':
            return { headline: 'Output stabile, effort maggiore', detail: `${currentRef}. Stesso output con RIR dichiarato più basso.` };
        case 'stable':
            if (current.trackingType === 'time') {
                return { headline: 'Durata registrata stabile', detail: `${previousRef} → ${currentRef}. La stessa durata non prova da sola una prestazione equivalente.` };
            }
            return { headline: 'Prestazione stabile', detail: `${previousRef} → ${currentRef}.` };
        case 'output_lower':
            return { headline: 'Output di riferimento inferiore', detail: `${previousRef} → ${currentRef}. È una variazione osservata della prestazione, non una conclusione fisiologica.` };
        case 'volume_progression':
            return {
                headline: 'Volume di lavoro aumentato',
                detail: `${previous?.workSets ?? 0} → ${current.workSets} serie, ${previous?.totalReps ?? 0} → ${current.totalReps} ripetizioni. Set di riferimento: ${previousRef} → ${currentRef}.`,
            };
        case 'maintenance_stable':
            return { headline: 'Performance di riferimento stabile nel mantenimento', detail: `Set di riferimento: ${previousRef} → ${currentRef}. Dose osservata: ${previous?.workSets ?? 0} → ${current.workSets} serie.` };
        case 'maintenance_change':
            return { headline: 'Mantenimento: variazione osservata', detail: `Set di riferimento: ${previousRef} → ${currentRef}. Dose osservata: ${previous?.workSets ?? 0} → ${current.workSets} serie. Il dato descrive la prestazione, non il mantenimento della massa muscolare.` };
        case 'deload_change':
            return { headline: 'Deload: variazione descrittiva', detail: `Set di riferimento: ${previousRef} → ${currentRef}. Dose osservata: ${previous?.workSets ?? 0} → ${current.workSets} serie. Le riduzioni programmate non vengono classificate come regressione.` };
        case 'execution_baseline':
            return { headline: 'Esecuzione: baseline registrata', detail: 'TheLogBook usa modalità, standard tecnico e parametri registrati. Non deduce la qualità tecnica da dati non inseriti.' };
        case 'density_limited':
            return { headline: 'Densità: confronto limitato alla sessione', detail: 'Non sono disponibili timestamp per attribuire una densità precisa al singolo esercizio.' };
        case 'new_baseline':
            return { headline: 'Nuova baseline', detail: previous ? 'Le condizioni registrate sono sostanzialmente diverse; evito un confronto diretto.' : `Prima esposizione confrontabile registrata: ${currentRef}.` };
        case 'descriptive_change':
            if (current.trackingType === 'time') {
                return {
                    headline: 'Variazione della durata registrata',
                    detail: `${previousRef} → ${currentRef}. La durata è cambiata, ma senza una direzione-obiettivo non indica automaticamente un miglioramento o un peggioramento.`,
                };
            }
            return { headline: 'Variazione descrittiva', detail: `${previousRef} → ${currentRef}. Carico e ripetizioni sono cambiati in direzioni che non supportano una conclusione univoca.` };
        default:
            return { headline: 'Dati insufficienti', detail: 'Le informazioni disponibili non supportano una conclusione diretta robusta.' };
    }
}

export function progressionQualityLabel(quality: ProgressionQuality): string {
    if (quality === 'clear') return 'Trend chiaro';
    if (quality === 'preliminary') return 'Indicazione preliminare';
    return 'Confronto limitato';
}

export function progressionTrendLabel(
    direction: ExerciseProgressionAnalysis['trendDirection'],
    intent?: TrainingCycleIntent,
): string {
    if (intent === 'deload') return 'Deload: andamento descrittivo';
    if (intent === 'maintenance') return 'Andamento in mantenimento';
    if (direction === 'duration_up') return 'Durata in aumento';
    if (direction === 'duration_down') return 'Durata in diminuzione';
    if (direction === 'up') return 'Trend in crescita';
    if (direction === 'stable') return 'Trend stabile';
    if (direction === 'down') return 'Trend in calo';
    if (direction === 'mixed') return 'Trend misto';
    return 'Trend non ancora definito';
}
