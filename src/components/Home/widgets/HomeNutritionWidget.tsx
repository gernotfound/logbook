import React from 'react';
import { Utensils } from 'lucide-react';

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
    const kcalPercent = kcalTarget > 0 ? Math.min((kcalEaten / kcalTarget) * 100, 100) : 0;
    const carbsPercent = Math.min((carbs / 300) * 100, 100);
    const proteinPercent = Math.min((pro / 150) * 100, 100);
    const fatPercent = Math.min((fat / 80) * 100, 100);

    const openNutrition = () => onNavigate('nutrition');

    return (
        <div
            className="nutrition-summary"
            role="button"
            tabIndex={0}
            onClick={openNutrition}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openNutrition();
                }
            }}
            aria-label="Apri riepilogo nutrizione"
        >
            <div className="nutrition-summary__header">
                <h2 className="nutrition-summary__title">
                    <Utensils size={20} aria-hidden="true" />
                    Nutrizione
                </h2>
                <div className="nutrition-summary__target">Target {kcalTarget} kcal</div>
            </div>

            <div className="nutrition-summary__body">
                <div
                    className="progress-ring"
                    style={{ '--progress': kcalPercent } as React.CSSProperties}
                    role="progressbar"
                    aria-valuenow={Math.round(kcalPercent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Calorie: ${Math.round(kcalPercent)}% completato`}
                >
                    <div className="progress-ring-content">
                        <span className="nutrition-ring__value">{kcalEaten}</span>
                        <span className="nutrition-ring__unit">kcal</span>
                    </div>
                </div>

                <div className="macro-stack">
                    <div>
                        <div className="macro-meta">
                            <span className="macro-label">CARBO</span>
                            <span className="macro-value">{carbs} g</span>
                        </div>
                        <div className="macro-progress">
                            <div className="macro-progress__fill macro-progress__fill--carbs" style={{ width: `${carbsPercent}%` }} />
                        </div>
                    </div>
                    <div>
                        <div className="macro-meta">
                            <span className="macro-label">PRO</span>
                            <span className="macro-value">{pro} g</span>
                        </div>
                        <div className="macro-progress">
                            <div className="macro-progress__fill macro-progress__fill--protein" style={{ width: `${proteinPercent}%` }} />
                        </div>
                    </div>
                    <div>
                        <div className="macro-meta">
                            <span className="macro-label">GRASSI</span>
                            <span className="macro-value">{fat} g</span>
                        </div>
                        <div className="macro-progress">
                            <div className="macro-progress__fill macro-progress__fill--fat" style={{ width: `${fatPercent}%` }} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HomeNutritionWidget;
