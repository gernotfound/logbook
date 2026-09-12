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

    return (
        <div
            className="home-nutrition-widget"
            onClick={() => onNavigate('nutrition')}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onNavigate('nutrition');
                }
            }}
            aria-label="Apri sezione nutrizione"
        >
            <div className="home-widget-heading">
                <h2>
                    <Utensils size={19} color="var(--primary-color)" aria-hidden="true" />
                    Nutrizione
                </h2>
                <div className="home-widget-meta">Target {kcalTarget} kcal</div>
            </div>

            <div className="home-nutrition-body">
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
                        <span className="home-calories-value">{kcalEaten}</span>
                        <span className="home-calories-unit">kcal</span>
                    </div>
                </div>

                <div className="home-macros">
                    <div className="home-macro home-macro--carbs">
                        <div className="home-macro__row"><span>Carbo</span><strong>{carbs} g</strong></div>
                        <div className="progress-bg"><div className="progress-fill" style={{ width: `${Math.min((carbs / 300) * 100, 100)}%` }} /></div>
                    </div>
                    <div className="home-macro home-macro--protein">
                        <div className="home-macro__row"><span>Proteine</span><strong>{pro} g</strong></div>
                        <div className="progress-bg"><div className="progress-fill" style={{ width: `${Math.min((pro / 150) * 100, 100)}%` }} /></div>
                    </div>
                    <div className="home-macro home-macro--fat">
                        <div className="home-macro__row"><span>Grassi</span><strong>{fat} g</strong></div>
                        <div className="progress-bg"><div className="progress-fill" style={{ width: `${Math.min((fat / 80) * 100, 100)}%` }} /></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HomeNutritionWidget;
