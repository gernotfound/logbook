import type { RefObject } from 'react';
import type { SessionExerciseSet } from '../../../types';

interface SessionSetRirPickerProps {
    set: SessionExerciseSet;
    sIndex: number;
    firstOptionRef: RefObject<HTMLButtonElement | null>;
    onEscape: () => void;
    onSelect: (rir: number | undefined) => void;
}

export function SessionSetRirPicker({ set: s, sIndex, firstOptionRef, onEscape, onSelect }: SessionSetRirPickerProps) {
    return (
        <div
            role="menu"
            aria-label={`Seleziona RIR serie ${sIndex + 1}`}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    onEscape();
                }
            }}
            style={{
                width: '100%',
                marginBottom: '8px',
                padding: '8px',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(44px, 1fr))',
                gap: '6px',
                background: 'var(--surface-light)',
                border: '1px solid var(--glass-border)',
                borderRadius: '10px',
                boxSizing: 'border-box'
            }}
        >
            {Array.from({ length: 11 }, (_, rir) => (
                <button
                    key={rir}
                    ref={rir === 0 ? firstOptionRef : undefined}
                    type="button"
                    role="menuitemradio"
                    aria-checked={s.rir === rir}
                    className="btn-icon"
                    style={{
                        minWidth: '44px',
                        minHeight: '44px',
                        padding: 0,
                        background: s.rir === rir ? 'var(--primary-color)' : 'var(--surface-color)',
                        color: s.rir === rir ? 'var(--on-primary)' : 'var(--text-main)',
                        fontWeight: 700
                    }}
                    onClick={() => onSelect(rir)}
                >
                    {rir}
                </button>
            ))}
            <button
                type="button"
                role="menuitem"
                className="btn btn-small"
                style={{ gridColumn: '1 / -1', minHeight: '44px', margin: 0 }}
                onClick={() => onSelect(undefined)}
            >
                Non registrato
            </button>
        </div>
    );
}
