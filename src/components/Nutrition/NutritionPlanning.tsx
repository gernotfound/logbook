import { useNutritionPlanning } from '../../hooks/useNutritionPlanning';
import { Save } from 'lucide-react';
import './TrackingViews.css';

function MacroSummary({ values }: { values: { proGrams: number; carbsGrams: number; fatGrams: number; totalKcal: number } }) {
    return <dl className="tracking-metrics">
        <div><dt>Proteine</dt><dd>{Math.round(values.proGrams)} g</dd></div>
        <div><dt>Carboidrati</dt><dd>{Math.round(values.carbsGrams)} g</dd></div>
        <div><dt>Grassi</dt><dd>{Math.round(values.fatGrams)} g</dd></div>
        <div><dt>Kcal</dt><dd>{Math.round(values.totalKcal)}</dd></div>
    </dl>;
}

const NutritionPlanning = () => {
    const { planning, onMacrosCalc, offMacrosCalc, avgMacrosCalc, tdeeCalc, currentOnMacros, currentOffMacros,
        handleUpdate, handleUpdateAvgMacros, handleUpdateOnBoost, handleSave } = useNutritionPlanning();
    return <div className="tracking-stack">
        <h1 className="tracking-heading">Pianificazione macro</h1>
        <div className="tracking-panel tracking-row">
            <label htmlFor="planning-on-days">Giorni ON (su 7)</label>
            <input id="planning-on-days" className="tracking-compact-input" type="number" inputMode="numeric" min="0" max="7" step="1" value={planning.onDaysCount !== undefined && planning.onDaysCount !== null ? planning.onDaysCount : 4} onChange={e => handleUpdate('onDaysCount', e.target.value)} onFocus={e => e.target.select()} />
        </div>
        <section className="tracking-panel">
            <h2 className="tracking-heading">Media settimanale desiderata</h2>
            <div className="tracking-fields">
                {([{ field: 'proPerKg', label: 'Pro (g/kg)' }, { field: 'carbsPerKg', label: 'Carbo (g/kg)' }, { field: 'fatPerKg', label: 'Grassi (g/kg)' }] as const).map(({ field, label }) => <div className="tracking-field" key={field}>
                    <label htmlFor={`planning-${field}`}>{label}</label>
                    <input id={`planning-${field}`} type="number" inputMode="decimal" min="0" step="0.1" value={planning.avgMacros?.[field] ?? ''} onChange={e => handleUpdateAvgMacros(field, e.target.value)} onFocus={e => e.target.select()} />
                </div>)}
            </div>
            <MacroSummary values={avgMacrosCalc} />
            <p className="tracking-description mt-10">Rapporto carboidrati / grassi: <strong>{avgMacrosCalc.fatGrams > 0 ? (avgMacrosCalc.carbsGrams / avgMacrosCalc.fatGrams).toFixed(2) : 0}</strong></p>
        </section>
        <section className="tracking-panel">
            <h2 className="tracking-heading">Variazioni giorni ON</h2>
            <p className="tracking-description">Varia in percentuale i macro nei giorni di allenamento.</p>
            <div className="tracking-fields">
                {([{ field: 'proPercent', label: 'Variazione pro (%)' }, { field: 'carbsPercent', label: 'Variazione carbo (%)' }, { field: 'fatPercent', label: 'Variazione grassi (%)' }] as const).map(({ field, label }) => <div className="tracking-field" key={field}>
                    <label htmlFor={`planning-${field}`}>{label}</label>
                    <input id={`planning-${field}`} type="number" inputMode="decimal" step="1" value={planning.onBoost?.[field] ?? ''} onChange={e => handleUpdateOnBoost(field, e.target.value)} onFocus={e => e.target.select()} />
                </div>)}
            </div>
        </section>
        <h2 className="tracking-heading">Ripartizione calcolata</h2>
        {[{ title: 'Giorno ON (Allenamento)', macros: currentOnMacros, totals: onMacrosCalc }, { title: 'Giorno OFF (Riposo)', macros: currentOffMacros, totals: offMacrosCalc }].map(day => <section key={day.title} className="tracking-panel">
            <h3 className="tracking-heading">{day.title}</h3>
            <p className="tracking-description">Pro: {Number(day.macros.proPerKg).toFixed(2)} g/kg · Carbo: {Number(day.macros.carbsPerKg).toFixed(2)} g/kg · Grassi: {Number(day.macros.fatPerKg).toFixed(2)} g/kg</p>
            <MacroSummary values={day.totals} />
        </section>)}
        <div className="tracking-panel tracking-field">
            <label htmlFor="planning-notes">Note</label>
            <textarea id="planning-notes" rows={4} placeholder="Scrivi qui eventuali note (es. integratori, orari dei pasti, variazioni nei giorni off...)" value={planning.notes || ''} onChange={e => handleUpdate('notes', e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary tracking-full-button" onClick={handleSave}><Save size={20} aria-hidden="true" /> Salva pianificazione</button>
        <section className="tracking-panel">
            <h2 className="tracking-heading">TDEE (normocalorica)</h2>
            <dl className="tracking-metrics tracking-metrics--two">
                <div><dt>TDEE (normo stimato)</dt><dd>{Math.round(tdeeCalc.tdee || 0)} kcal</dd></div>
                <div><dt>Media impostata</dt><dd>{Math.round(avgMacrosCalc.totalKcal)} kcal</dd></div>
            </dl>
            <p className="tracking-description mt-10">Il tuo TDEE viene calcolato automaticamente in base alle tue misurazioni corporee e profilo.</p>
        </section>
    </div>;
};
export default NutritionPlanning;
