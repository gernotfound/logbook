import type { useNutritionPlanning } from '../../hooks/useNutritionPlanning';

type NutritionPlanningViewModel = ReturnType<typeof useNutritionPlanning>;

interface NutritionMacroDaySummaryProps {
    mode: 'on' | 'off';
    macroRatios: NutritionPlanningViewModel['currentOnMacros'];
    macroTotals: NutritionPlanningViewModel['onMacrosCalc'];
}

export function NutritionMacroDaySummary({ mode, macroRatios, macroTotals }: NutritionMacroDaySummaryProps) {
    return (
                    <div className="card" style={{ marginBottom: 0, padding: '15px' }}>
                        <div style={{ fontSize: 'var(--font-size-control)', color: mode === 'on' ? 'var(--primary-color)' : 'var(--text-main)', fontWeight: 'bold', marginBottom: '10px' }}>{mode === 'on' ? '🔥 Giorno ON (Allenamento)' : '🛋️ Giorno OFF (Riposo)'}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>Pro: <span style={{ color: 'var(--text-main)' }}>{Number(macroRatios.proPerKg).toFixed(2)} g/kg</span></div>
                            <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>Car: <span style={{ color: 'var(--text-main)' }}>{Number(macroRatios.carbsPerKg).toFixed(2)} g/kg</span></div>
                            <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>Gra: <span style={{ color: 'var(--text-main)' }}>{Number(macroRatios.fatPerKg).toFixed(2)} g/kg</span></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--surface-color)', padding: '8px', borderRadius: '6px' }}>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>PRO</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(macroTotals.proGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>CAR</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(macroTotals.carbsGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>GRA</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(macroTotals.fatGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1, borderLeft: '1px solid var(--glass-border)' }}><div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>KCAL</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(macroTotals.totalKcal)}</div></div>
                        </div>
                    </div>
    );
}
