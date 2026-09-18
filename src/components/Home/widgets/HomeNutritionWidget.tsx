import { Utensils, ChevronRight } from 'lucide-react';

interface HomeNutritionWidgetProps {
    kcalEaten?: number; kcalTarget?: number; carbs?: number; pro?: number; fat?: number;
    onNavigate: (view: string) => void;
}

export function HomeNutritionWidget({ kcalEaten = 0, kcalTarget = 0, carbs = 0, pro = 0, fat = 0, onNavigate }: HomeNutritionWidgetProps) {
    const percent = kcalTarget > 0 ? Math.max(0, Math.min(kcalEaten / kcalTarget * 100, 100)) : 0;
    return (
        <section className="home-nutrition">
            <h2><button type="button" className="home-section-link" onClick={() => onNavigate('nutrition')} aria-label="Apri diario alimentare">
                <Utensils size={22} aria-hidden="true" /><span>Nutrizione</span><ChevronRight size={20} aria-hidden="true" />
            </button></h2>
            <div className="home-nutrition-summary">
                <div className="home-calorie-ring" role={kcalTarget > 0 ? 'progressbar' : undefined}
                    aria-valuenow={kcalTarget > 0 ? Math.round(percent) : undefined}
                    aria-valuemin={kcalTarget > 0 ? 0 : undefined} aria-valuemax={kcalTarget > 0 ? 100 : undefined}
                    aria-label={kcalTarget > 0 ? `Calorie: ${Math.round(percent)}% completato` : 'Calorie registrate'}>
                    <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="home-ring-track" cx="50" cy="50" r="44" />
                        <circle className="home-ring-value" cx="50" cy="50" r="44" pathLength="100" strokeDasharray={`${percent} 100`} /></svg>
                    <div><strong>{kcalEaten}</strong><span className="text-sm home-muted">kcal</span></div>
                </div>
                <div className="home-nutrition-details">
                    <p className="text-sm home-muted">{kcalTarget > 0 ? `Obiettivo: ${kcalTarget} kcal` : 'Obiettivo non impostato'}</p>
                    <dl className="home-macros">
                        <div><dt>Carboidrati</dt><dd>{carbs} <span>g</span></dd></div>
                        <div><dt>Proteine</dt><dd>{pro} <span>g</span></dd></div>
                        <div><dt>Grassi</dt><dd>{fat} <span>g</span></dd></div>
                    </dl>
                </div>
            </div>
        </section>
    );
}
export default HomeNutritionWidget;
