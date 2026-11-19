import { BufferedInput } from '../../UI/BufferedInput';
import type { SessionSetRowProps } from './sessionSetRowTypes';

interface SessionSetPrimaryFieldsProps extends Pick<SessionSetRowProps, 'set' | 'exIndex' | 'trackingType' | 'onUpdateSet'> {
    recoveryPrefix: string;
}

export function SessionSetPrimaryFields({ set: s, exIndex, trackingType, onUpdateSet, recoveryPrefix }: SessionSetPrimaryFieldsProps) {
    return (
        <>
            {trackingType === 'time' ? (
                <>
                    <BufferedInput
                        id={`${recoveryPrefix}kg-${s.id}`}
                        type="number"
                        step="0.25"
                        placeholder="Kg (opz)"
                        value={s.kg ?? ''}
                        onChange={val => onUpdateSet(exIndex, s.id, 'kg', val)}
                        onFocus={e => e.target.select()}
                        style={{ margin: 0, flex: 1, minWidth: 0 }}
                    />
                    <BufferedInput
                        id={`${recoveryPrefix}time-${s.id}`}
                        type="text"
                        placeholder="Tempo (es. 60s)"
                        value={s.time ?? ''}
                        onChange={val => onUpdateSet(exIndex, s.id, 'time', val)}
                        onFocus={e => e.target.select()}
                        style={{ margin: 0, flex: 2, minWidth: 0 }}
                    />
                </>
            ) : (
                <>
                    <BufferedInput
                        id={`${recoveryPrefix}kg-${s.id}`}
                        type="number"
                        step="0.25"
                        placeholder="Kg"
                        value={s.kg ?? ''}
                        onChange={val => onUpdateSet(exIndex, s.id, 'kg', val)}
                        onFocus={e => e.target.select()}
                        style={{ margin: 0, flex: 1, minWidth: 0 }}
                    />
                    <BufferedInput
                        id={`${recoveryPrefix}reps-${s.id}`}
                        type="number"
                        placeholder="Reps"
                        value={s.reps ?? ''}
                        onChange={val => onUpdateSet(exIndex, s.id, 'reps', val)}
                        onFocus={e => e.target.select()}
                        style={{ margin: 0, flex: 1, minWidth: 0 }}
                    />
                </>
            )}
        </>
    );
}
