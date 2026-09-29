import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Logic } from '../../../lib/logic';
import SessionExerciseCard from './SessionExerciseCard';

type SessionExerciseAccordionProps = React.ComponentProps<typeof SessionExerciseCard> & {
    isCurrent: boolean;
    initiallyExpanded?: boolean;
    onActivate?: (index: number) => void;
};

const SessionExerciseAccordion = (props: SessionExerciseAccordionProps) => {
    const {
        isCurrent,
        initiallyExpanded = false,
        onActivate,
        ...cardProps
    } = props;
    const { exItem, exIndex, libDef } = cardProps;
    const [expanded, setExpanded] = React.useState(initiallyExpanded);

    const exerciseName = libDef?.name || 'Esercizio rimosso';
    const setsCount = Array.isArray(exItem?.sets) ? exItem.sets.length : 0;
    const range = exItem?.minReps || exItem?.maxReps
        ? `${exItem?.minReps || '–'}–${exItem?.maxReps || '–'}`
        : '';
    const primaryMuscles = Array.isArray(libDef?.muscles)
        ? libDef.muscles
            .map((muscleId: string) => Logic.getMuscleName(muscleId) || muscleId)
            .filter(Boolean)
            .slice(0, 2)
        : [];

    const summaryParts = [
        `${setsCount} ${setsCount === 1 ? 'serie' : 'serie'}`,
        range,
        primaryMuscles.length > 0 ? `Primari: ${primaryMuscles.join(' · ')}` : '',
    ].filter(Boolean);

    const toggleExpanded = () => {
        setExpanded(current => {
            const next = !current;
            if (next) onActivate?.(exIndex);
            return next;
        });
    };

    const bodyId = `session-exercise-body-${exItem?.id || exItem?.exId || exIndex}`;

    return (
        <article className={`session-exercise-shell${isCurrent ? ' current' : ''}`}>
            <button
                type="button"
                className="session-exercise-summary"
                onClick={toggleExpanded}
                aria-expanded={expanded}
                aria-controls={bodyId}
            >
                <span className="session-exercise-index" aria-hidden="true">{exIndex + 1}</span>
                <span className="session-exercise-summary-copy">
                    <span className="session-exercise-name">{exerciseName}</span>
                    <span className="session-exercise-meta">{summaryParts.join(' · ')}</span>
                </span>
                <span className="session-exercise-disclosure" aria-hidden="true">
                    {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </span>
            </button>
            <div
                id={bodyId}
                className="session-exercise-shell-body"
                style={{ display: expanded ? 'block' : 'none' }}
            >
                <SessionExerciseCard {...cardProps} />
            </div>
        </article>
    );
};

export default React.memo(SessionExerciseAccordion);
