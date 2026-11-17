import { ChevronRight, Utensils } from 'lucide-react';

interface HomeNutritionWidgetProps {
    kcalEaten?: number;
    kcalTarget?: number;
    carbs?: number;
    pro?: number;
    fat?: number;
    onNavigate: (view: string) => void;
}

export const HomeNutritionWidget = ({
    kcalEaten = 0,
    kcalTarget = 0,
    carbs = 0,
    pro = 0,
    fat = 0,
    onNavigate
}: HomeNutritionWidgetProps) => {
    const hasTarget = kcalTarget > 0;
    const actualPercent = hasTarget ? (kcalEaten / kcalTarget) * 100 : 0;
    const kcalPercent = Math.max(0, Math.min(actualPercent, 100));
    return (
        <section className="home-nutrition">
            <h2><button type="button" className="home-section-link" onClick={() => onNavigate('nutrition')} aria-label="Nutrizione: apri il diario alimentare"><Utensils size={22} aria-hidden="true" /><span>Nutrizione</span><ChevronRight size={20} aria-hidden="true" /></button></h2>
            <div className="home-nutrition-summary">
                <div className="home-calorie-ring" role={hasTarget ? 'progressbar' : 'group'}
                    aria-valuenow={hasTarget ? Math.round(kcalPercent) : undefined} aria-valuemin={hasTarget ? 0 : undefined}
                    aria-valuemax={hasTarget ? 100 : undefined} aria-label={hasTarget ? 'Calorie giornaliere' : 'Calorie registrate'}
                    aria-valuetext={hasTarget ? `${kcalEaten} kcal registrate su ${kcalTarget} kcal di obiettivo (${Math.round(actualPercent)}%)` : undefined}>
                    <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="home-ring-track" cx="50" cy="50" r="44" /><circle className="home-ring-value" cx="50" cy="50" r="44" pathLength="100" strokeDasharray={`${kcalPercent} 100`} /></svg>
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
};

export default HomeNutritionWidget;
