import type { TrainingCycleStrategy } from '../../../types';
import { getCycleStrategyLabel, getMuscleName } from '../../../lib/trainingCycleStrategy';

function muscleNames(ids: string[] | undefined): string {
    return ids?.map(getMuscleName).join(', ') ?? '';
}

export function CycleStrategySummary({ strategy }: { strategy?: TrainingCycleStrategy }) {
    if (!strategy) {
        return (
            <div className="text-xs text-muted" data-testid="cycle-strategy-unspecified">
                Obiettivo non specificato
            </div>
        );
    }

    const primary = muscleNames(strategy.primaryMuscles);
    const secondary = muscleNames(strategy.secondaryMuscles);

    return (
        <div
            data-testid="cycle-strategy-summary"
            style={{ display: 'grid', gap: '4px', fontSize: '0.85rem' }}
        >
            <div style={{ color: 'var(--text-main)', fontWeight: 700 }}>
                {getCycleStrategyLabel(strategy)}
            </div>
            {primary && (
                <div className="text-muted">
                    <strong style={{ color: 'var(--text-main)' }}>Primario:</strong> {primary}
                </div>
            )}
            {secondary && (
                <div className="text-muted">
                    <strong style={{ color: 'var(--text-main)' }}>Secondario:</strong> {secondary}
                </div>
            )}
        </div>
    );
}
