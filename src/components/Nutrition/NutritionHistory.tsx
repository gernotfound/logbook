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
                <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Storico pasti ({nutritionHistory.length})</h1>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                Tutti i pasti registrati in ordine cronologico.
            </p>

            {nutritionHistory.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '10px' }}>🍽️</div>
                    <p style={{ margin: 0 }}>Nessun pasto registrato finora.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {nutritionHistory.map((day: any, idx: number) => (
                        <div 
                            key={`hist-nutr-${day.date}-${idx}`} 
                            className="card clickable-card" 
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
                                <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: 'white', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    📅 {Logic.formatItalianDate ? Logic.formatItalianDate(day.date) : day.date}
                                    <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                                        {day.isDayOn ? '🔥 ON' : '🛋️ OFF'}
                                    </span>
                                </div>
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Kcal</div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--warning-color)' }}>{Math.round(day.kcal || 0)}</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Pro</div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--success-color)' }}>{Math.round(day.pro || 0)}g</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Car</div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>{Math.round(day.carbs || 0)}g</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Gra</div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--danger-color)' }}>{Math.round(day.fat || 0)}g</div>
                                    </div>
                                </div>

                                {day.meals && day.meals.length > 0 && (
                                    <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        🍽️ {day.meals.length} alimenti inseriti
                                    </div>
                                )}
                                
                                {day.supplementsIntake && day.supplementsIntake.length > 0 && (
                                    <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--primary-color)' }}>
                                        💊 {day.supplementsIntake.length} integratori assunti
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default NutritionHistory;
