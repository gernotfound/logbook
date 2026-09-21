import type { Supplement, SupplementIntake } from '../../../types';

interface NutritionSupplementIntakesProps {
    intakes: SupplementIntake[];
    supplementsLibrary: Supplement[];
    onRemoveIntake: (intakeId: string) => void | Promise<void>;
}

export function NutritionSupplementIntakes({
    intakes,
    supplementsLibrary,
    onRemoveIntake,
}: NutritionSupplementIntakesProps) {
    if (intakes.length === 0) return null;

    return (
        <section className="tracking-panel">
            <div className="tracking-row tracking-row--wrap mb-10 pb-10 border-b">
                <h2 className="tracking-heading">Integratori</h2>
                <span className="text-sm text-muted">
                    {intakes.length} assunzioni
                </span>
            </div>

            {intakes.map(intake => {
                const supplement = supplementsLibrary.find(item => item.id === intake.supplementId);
                const timeStr = new Date(intake.time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                return (
                    <div
                        key={intake.id}
                        className="tracking-meal-row"
                    >
                        <div>
                            <div className="font-bold flex items-center gap-6">
                                <span>{supplement ? supplement.name : 'Integratore eliminato'}</span>
                            </div>
                            <div className="text-muted text-sm mt-2">
                                {intake.amount} {supplement ? supplement.unit : 'g'} • {timeStr}
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn-icon text-danger"
                            onClick={() => onRemoveIntake(intake.id)}
                            aria-label="Rimuovi integratore"
                        >
                            ✕
                        </button>
                    </div>
                );
            })}
        </section>
    );
}
