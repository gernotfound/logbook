import React from 'react';

interface HomeTdeeWidgetProps {
    tdeeCalc?: {
        error?: boolean;
        message?: string;
        tdee?: number;
        avgKcal?: number;
        weightDiff?: number | string;
        dailyDeficit?: number;
        daysTracked?: number;
    } | null;
}

export const HomeTdeeWidget: React.FC<HomeTdeeWidgetProps> = ({ tdeeCalc }) => {
    return (
        <div className="card" style={{ border: '1px solid rgba(46, 204, 113, 0.3)', background: 'var(--surface-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 style={{margin: 0, color: 'var(--success-color)'}}>TDEE reale stimato</h2>
                    <p style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Basato sull'andamento del peso</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    {tdeeCalc?.error ? (
                        <span style={{ fontSize: 'var(--font-size-display-sm)', fontWeight: 'bold', color: 'var(--text-muted)' }}>-- kcal</span>
                    ) : (
                        <span style={{ fontSize: 'var(--font-size-display-xl)', fontWeight: 'bold', color: 'var(--success-color)' }}>{tdeeCalc?.tdee} <span style={{fontSize: 'var(--font-size-control)'}}>kcal</span></span>
                    )}
                </div>
            </div>
            
            <div style={{ marginTop: '15px', padding: '10px', background: 'var(--surface-light)', borderRadius: '8px', fontSize: 'var(--font-size-meta)' }}>
                {tdeeCalc?.error ? (
                    <div style={{ color: 'var(--warning-color)', textAlign: 'center' }}>
                        ⏳ {tdeeCalc?.message}
                    </div>
                ) : (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Media calorie assunte ({tdeeCalc?.daysTracked}gg):</span>
                            <span style={{ fontWeight: 'bold' }}>{tdeeCalc?.avgKcal} kcal</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Variazione peso totale:</span>
                            <span style={{ fontWeight: 'bold', color: Number(tdeeCalc?.weightDiff || 0) > 0 ? 'var(--danger-color)' : 'var(--success-color)' }}>{Number(tdeeCalc?.weightDiff || 0) > 0 ? '+' : ''}{tdeeCalc?.weightDiff} kg</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Deficit/surplus teorico:</span>
                            <span style={{ fontWeight: 'bold' }}>{(tdeeCalc as any)?.dailyDeficit! > 0 ? '+' : ''}{(tdeeCalc as any)?.dailyDeficit} kcal/gg</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HomeTdeeWidget;
