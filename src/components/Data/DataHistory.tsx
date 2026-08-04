import React from 'react';

interface DataHistoryProps {
    measurementsHistory: any[];
    editingDate: string | null;
    onSelectEdit: (day: any) => void;
}

const DataHistory: React.FC<DataHistoryProps> = ({
    measurementsHistory,
    editingDate,
    onSelectEdit
}) => {
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0 }}>Storico Misurazioni ({measurementsHistory.length})</h3>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                Tutte le misurazioni registrate in ordine cronologico. Clicca su una voce per modificarla.
            </p>

            {measurementsHistory.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📏</div>
                    <p style={{ margin: 0 }}>Nessuna misurazione registrata finora.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {measurementsHistory.map((day: any) => (
                        <div 
                            key={day.date} 
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
                            onClick={() => onSelectEdit(day)}
                        >
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: editingDate === day.date ? 'var(--primary-color)' : 'white' }}>
                                    📅 {day.date} {day.measurementTime ? `alle ${day.measurementTime}` : ''}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    {day.weight && <span>⚖️ <strong>{day.weight} kg</strong></span>}
                                    {day.bf && <span>📊 BF: <strong>{day.bf}%</strong></span>}
                                    {day.waist && <span>| Vita: {day.waist}cm</span>}
                                    {day.neck && <span>| Collo: {day.neck}cm</span>}
                                    {day.hip && <span>| Fianchi: {day.hip}cm</span>}
                                </div>
                            </div>
                            <div style={{ color: 'var(--primary-color)', fontSize: '1.1rem', opacity: 0.8 }}>
                                ✏️
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default DataHistory;
