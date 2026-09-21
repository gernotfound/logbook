import { memo, useId } from 'react';
import MuscleModel from '../MuscleModel';

interface CycleMuscleMapProps {
    title: string;
    highlightedMuscles: string[];
    emptyMessage?: string;
}

export const CycleMuscleMap = memo(function CycleMuscleMap({
    title,
    highlightedMuscles,
    emptyMessage
}: CycleMuscleMapProps) {
    const titleId = useId();

    return (
        <section className="cycle-muscle-map" aria-labelledby={titleId}>
            <h3 id={titleId} className="cycle-muscle-map-title">{title}</h3>
            <div className="cycle-muscle-map-model">
                <MuscleModel selectedMuscles={highlightedMuscles} />
            </div>
            {highlightedMuscles.length === 0 && emptyMessage ? (
                <p className="cycle-muscle-map-empty">{emptyMessage}</p>
            ) : null}
        </section>
    );
});
