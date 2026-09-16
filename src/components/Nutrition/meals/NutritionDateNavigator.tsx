import { Logic } from '../../../lib/logic';

interface NutritionDateNavigatorProps {
    targetDateStr: string;
    onPrevious: () => void;
    onNext: () => void;
    onToday: () => void;
}

export function NutritionDateNavigator({
    targetDateStr,
    onPrevious,
    onNext,
    onToday,
}: NutritionDateNavigatorProps) {
    const today = Logic.getLocalDateString();
    const isToday = targetDateStr === today;

    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <button className="btn btn-small" onClick={onPrevious} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)' }}>◀ Prec.</button>
            <div style={{ textAlign: 'center', flex: 1, margin: '0 10px', cursor: 'pointer' }} onClick={onToday} title="Torna a oggi">
                <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {Logic.formatItalianDate ? Logic.formatItalianDate(targetDateStr) : targetDateStr}
                </div>
                {isToday && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>OGGI</div>
                )}
            </div>
            <button className="btn btn-small" onClick={onNext} disabled={isToday} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', opacity: isToday ? 0.3 : 1 }}>Succ. ▶</button>
        </div>
    );
}
