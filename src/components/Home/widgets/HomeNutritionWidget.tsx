import React from 'react';

interface HomeNutritionWidgetProps {
    kcalEaten?: number;
    kcalTarget?: number;
    carbs?: number;
    pro?: number;
    fat?: number;
    onNavigate: (view: string) => void;
}

export const HomeNutritionWidget: React.FC<HomeNutritionWidgetProps> = ({
    kcalEaten = 0,
    kcalTarget = 0,
    carbs = 0,
    pro = 0,
    fat = 0,
    onNavigate
}) => {
    return (
        <div className="card" id="home-nutrition-widget">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>Nutrizione Odierna</h3>
                <button className="btn-icon" style={{ color: 'var(--primary-color)' }} onClick={() => onNavigate('nutrition')}>✏️</button>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)' }}>{kcalEaten}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>kcal assunte</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--warning-color)' }}>{kcalTarget}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>TDEE teorico</div>
                </div>
            </div>

            <div className="progress-bg" style={{ marginBottom: '20px' }}>
                <div className="progress-fill" style={{ width: `${kcalTarget > 0 ? Math.min((kcalEaten / kcalTarget) * 100, 100) : 0}%`, background: 'linear-gradient(90deg, var(--warning-color), #fcd34d)' }}></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '12px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--success-color)', fontWeight: 'bold' }}>CARBO</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{carbs}g</div>
                </div>
                <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '12px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 'bold' }}>PRO</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{pro}g</div>
                </div>
                <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '12px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--danger-color)', fontWeight: 'bold' }}>GRASSI</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{fat}g</div>
                </div>
            </div>
        </div>
    );
};

export default HomeNutritionWidget;
