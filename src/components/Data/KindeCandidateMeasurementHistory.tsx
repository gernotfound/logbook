import { useMemo, useRef } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { captureMeasurement, selectMeasurementHistory } from '../../lib/nutrition/measurementHistory';
import { hasMeasurementData } from '../../lib/nutrition/measurementPresence';
import { useDialogStore } from '../../store/useDialogStore';
import type { NutritionDay } from '../../types';
import DataHistory from './DataHistory';
import './data-history.css';

const EMPTY_NUTRITION: Record<string, NutritionDay> = {};

export function KindeCandidateMeasurementHistory({ realm }: { realm: ReturnType<typeof useKindeCandidateFitnessLifecycle> }) {
    const pending = useRef(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    const nutrition = realm.state.phase === 'ready' ? realm.state.snapshot.data.nutrition ?? EMPTY_NUTRITION : EMPTY_NUTRITION;
    const history = useMemo(() => selectMeasurementHistory(nutrition), [nutrition]);
    if (realm.state.phase !== 'ready') return null;

    const remove = async (date: string) => {
        if (pending.current) return;
        const witness = realm.captureEditWitness();
        const day = nutrition[date];
        if (!witness?.isCurrent() || !day || !hasMeasurementData(day)) return;
        const expected = captureMeasurement(day);
        pending.current = true;
        try {
            if (!(await showConfirm('Eliminare questa misurazione? Gli altri dati del giorno saranno conservati.'))
                || !witness.isCurrent()) return;
            await realm.submit({ type: 'measurement.delete', date, expected });
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile eliminare la misurazione.');
        } finally {
            pending.current = false;
        }
    };

    return (
        <section aria-label="Storico rilevazioni account">
            <DataHistory measurementsHistory={history} editingDate={null} onDeleteMeasurement={date => { void remove(date); }} />
        </section>
    );
}
