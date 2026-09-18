import React from 'react';
import { Logic } from '../../lib/logic';
import { ContextMenu } from '../UI/ContextMenu';
import { Pencil, Trash2, Ruler } from 'lucide-react';
import '../Nutrition/TrackingViews.css';

interface DataHistoryProps {
    measurementsHistory: any[];
    editingDate: string | null;
    onSelectEdit: (day: any) => void;
    onDeleteMeasurement: (date: string) => void;
}

const DataHistory: React.FC<DataHistoryProps> = ({ measurementsHistory, editingDate, onSelectEdit, onDeleteMeasurement }) => <div>
    <h1 className="tracking-heading">Storico misurazioni ({measurementsHistory.length})</h1>
    <p className="tracking-description">Tutte le misurazioni registrate in ordine cronologico. Usa le opzioni per modificare o eliminare una misurazione.</p>
    {measurementsHistory.length === 0 ? <div className="card tracking-empty"><Ruler size={32} aria-hidden="true" /><p>Nessuna misurazione registrata finora.</p></div> :
        <div className="tracking-list">{measurementsHistory.map((day: any, idx: number) => <div key={day.date ? `${day.date}-${day.measurementTime || ''}-${idx}` : `hist-${idx}`} className={`card tracking-history-card ${editingDate === day.date ? 'tracking-panel--editing' : ''}`}>
            <button type="button" className="tracking-history-open" onClick={() => onSelectEdit(day)} aria-label={`Modifica misurazione del ${Logic.formatItalianDate(day.date)}${day.measurementTime ? ` alle ${day.measurementTime}` : ''}`}>
                <span className="font-semibold">{Logic.formatItalianDate(day.date)} {day.measurementTime ? `alle ${day.measurementTime}` : ''}</span>
                <span className="tracking-history-detail">
                    {day.weight && <span>Peso: <strong>{day.weight} kg</strong></span>}
                    {day.bf && <span>BF: <strong>{day.bf}%</strong></span>}
                    {day.waist && <span>Vita: {day.waist} cm</span>}
                    {day.neck && <span>Collo: {day.neck} cm</span>}
                    {day.hip && <span>Fianchi: {day.hip} cm</span>}
                    {day.sleepHours && <span>Sonno: {Logic.formatSleepTime(day.sleepHours)}</span>}
                </span>
            </button>
            <ContextMenu items={[
                { label: 'Modifica', icon: <Pencil size={20} aria-hidden="true" />, onClick: () => onSelectEdit(day) },
                { label: 'Elimina', icon: <Trash2 size={20} aria-hidden="true" />, onClick: () => onDeleteMeasurement(day.date), variant: 'danger' as const }
            ]} />
        </div>)}</div>}
</div>;
export default DataHistory;
