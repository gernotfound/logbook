import React from 'react';
import { Logic } from '../../lib/logic';
import { ContextMenu } from '../UI/ContextMenu';
import { Pencil, Trash2 } from 'lucide-react';

interface DataHistoryProps {
    measurementsHistory: any[];
    editingDate: string | null;
    onSelectEdit: (day: any) => void;
    onDeleteMeasurement: (date: string) => void;
}

const DataHistory: React.FC<DataHistoryProps> = ({
    measurementsHistory,
    editingDate,
    onSelectEdit,
    onDeleteMeasurement
}) => {
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h1 style={{margin: 0}}>Storico misurazioni ({measurementsHistory.length})</h1>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                Tutte le misurazioni registrate in ordine cronologico. Usa le opzioni per modificare o eliminare una misurazione.
            </p>

            {measurementsHistory.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📏</div>
                    <p style={{ margin: 0 }}>Nessuna misurazione registrata finora.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {measurementsHistory.map((day: any, idx: number) => (
                        <div 
                            key={day.date ? `${day.date}-${day.measurementTime || ''}-${idx}` : `hist-${idx}`} 
                            className="card" 
                            style={{ 
                                padding: '15px', 
                                marginBottom: 0, 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                cursor: 'pointer',
                                borderLeft: editingDate === day.date ? '4px solid var(--primary-color)' : '1px solid var(--glass-border)',
                                transition: 'all 0.2s ease'
                            }}
                            
                        >
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: editingDate === day.date ? 'var(--primary-color)' : 'white' }}>
                                    📅 {Logic.formatItalianDate ? Logic.formatItalianDate(day.date) : day.date} {day.measurementTime ? `alle ${day.measurementTime}` : ''}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    {day.weight && <span>⚖️ <strong>{day.weight} kg</strong></span>}
                                    {day.bf && <span>📊 BF: <strong>{day.bf}%</strong></span>}
                                    {day.waist && <span>| Vita: {day.waist}cm</span>}
                                    {day.neck && <span>| Collo: {day.neck}cm</span>}
                                    {day.hip && <span>| Fianchi: {day.hip}cm</span>}
                                    {day.sleepHours && <span>| 🌙 Sonno: {Logic.formatSleepTime(day.sleepHours)}</span>}
                                </div>
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                                <ContextMenu
                                    items={[
                                        {
                                            label: 'Modifica',
                                            icon: <Pencil size={16} />,
                                            onClick: () => onSelectEdit(day)
                                        },
                                        {
                                            label: 'Elimina',
                                            icon: <Trash2 size={16} />,
                                            onClick: () => onDeleteMeasurement(day.date),
                                            variant: 'danger' as const
                                        }
                                    ]}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default DataHistory;
