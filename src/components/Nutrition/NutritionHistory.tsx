import React from 'react';
import { Logic } from '../../lib/logic';

interface NutritionHistoryProps {
    nutritionHistory: any[];
    onDayClick?: (dateStr: string) => void;
}

const NutritionHistory: React.FC<NutritionHistoryProps> = ({ nutritionHistory, onDayClick }) => {
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h1 style={{margin: 0,color: 'var(--text-main)'}}>Storico pasti ({nutritionHistory.length})</h1>
            </div>
            <p style={{  color: 'var(--text-muted)', marginBottom: '15px' }} className="text-sm">
                Tutti i pasti registrati in ordine cronologico.
            </p>

            {nutritionHistory.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    <div style={{  marginBottom: '10px' }} className="text-2xl">🍽️</div>
                    <p style={{ margin: 0 }}>Nessun pasto registrato finora.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {nutritionHistory.map((day: any, idx: number) => (
                        <button type="button"
                            key={`hist-nutr-${day.date}-${idx}`}
                            className="card nutrition-history-button" aria-label={`Apri pasti del ${Logic.formatItalianDate(day.date)}`}
                            onClick={() => onDayClick && onDayClick(day.date)}
                            style={{
                                padding: '15px',
                                marginBottom: 0,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderLeft: '1px solid var(--glass-border)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ width: '100%' }}>
                                <div style={{ fontWeight: 'bold',  color: 'var(--text-main)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }} className="text-base">
                                    📅 {Logic.formatItalianDate ? Logic.formatItalianDate(day.date) : day.date}
                                    <span style={{  opacity: 0.8 }} className="text-sm">
                                        {day.isDayOn ? '🔥 ON' : '🛋️ OFF'}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-light)', padding: '10px', borderRadius: '8px' }}>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{  color: 'var(--text-muted)', textTransform: 'uppercase' }} className="text-sm">Kcal</div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(day.kcal || 0)}</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{  color: 'var(--text-muted)', textTransform: 'uppercase' }} className="text-sm">Pro</div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(day.pro || 0)}g</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{  color: 'var(--text-muted)', textTransform: 'uppercase' }} className="text-sm">Car</div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(day.carbs || 0)}g</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{  color: 'var(--text-muted)', textTransform: 'uppercase' }} className="text-sm">Gra</div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(day.fat || 0)}g</div>
                                    </div>
                                </div>

                                {day.meals && day.meals.length > 0 && (
                                    <div style={{ marginTop: '10px',  color: 'var(--text-muted)' }} className="text-sm">
                                        🍽️ {day.meals.length} alimenti inseriti
                                    </div>
                                )}

                                {day.supplementsIntake && day.supplementsIntake.length > 0 && (
                                    <div style={{ marginTop: '6px',  color: 'var(--text-muted)' }} className="text-sm">
                                        💊 {day.supplementsIntake.length} integratori assunti
                                    </div>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default NutritionHistory;
