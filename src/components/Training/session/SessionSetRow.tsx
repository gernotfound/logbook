import React from 'react';
import { Trash2, Layers, Timer } from 'lucide-react';
import { BufferedInput } from '../../UI/BufferedInput';
import { ContextMenu } from '../../UI/ContextMenu';

interface SessionSetRowProps {
    set: any;
    sIndex: number;
    exIndex: number;
    trackingType?: string;
    isOpenMenu: boolean;
    onToggleMenu: () => void;
    onRemoveSet: (sIndex: number) => void;
    onUpdateSet: (setId: string, field: string, value: any) => void;
    onAddSpecialSet: (type: string, setId: string) => void;
    onUpdateSpecialSet: (setId: string, type: 'dropsets' | 'isometrics', idx: number, field: string, value: any) => void;
    onRemoveSpecialSet: (setId: string, type: 'dropsets' | 'isometrics', idx: number) => void;
}

const SessionSetRowInner: React.FC<SessionSetRowProps> = ({ set: s, sIndex, trackingType, onRemoveSet, onUpdateSet, onAddSpecialSet, onUpdateSpecialSet, onRemoveSpecialSet }) => (
    <div className="workout-set-group">
        <div className="set-row workout-set-row">
            <span className="workout-set-number">S{sIndex + 1}</span>
            <label className="workout-set-field"><span>kg{trackingType === 'time' ? ' (opz.)' : ''}</span><BufferedInput id={`kg-${s.id}`} type="number" inputMode="decimal" step="0.25" placeholder={trackingType === 'time' ? 'Kg (opz)' : 'Kg'} aria-label={`Serie ${sIndex + 1}, chilogrammi`} value={s.kg ?? ''} onChange={value => onUpdateSet(s.id, 'kg', value)} onFocus={e => e.target.select()} /></label>
            <label className="workout-set-field"><span>{trackingType === 'time' ? 'Tempo' : 'Ripetizioni'}</span><BufferedInput id={`${trackingType === 'time' ? 'time' : 'reps'}-${s.id}`} type={trackingType === 'time' ? 'text' : 'number'} inputMode={trackingType === 'time' ? 'text' : 'numeric'} placeholder={trackingType === 'time' ? 'Tempo (es. 60s)' : 'Reps'} aria-label={`Serie ${sIndex + 1}, ${trackingType === 'time' ? 'tempo' : 'ripetizioni'}`} value={(trackingType === 'time' ? s.time : s.reps) ?? ''} onChange={value => onUpdateSet(s.id, trackingType === 'time' ? 'time' : 'reps', value)} onFocus={e => e.target.select()} /></label>
            <ContextMenu className="workout-set-menu" ariaLabel={`Opzioni serie ${sIndex + 1}`} items={[
                { label: '+ Dropset', icon: Layers, onClick: () => onAddSpecialSet('dropset', s.id) },
                { label: '+ Isometria', icon: Timer, onClick: () => onAddSpecialSet('isometry', s.id) },
                { label: `Rimuovi serie ${sIndex + 1}`, icon: Trash2, variant: 'danger', onClick: () => onRemoveSet(sIndex) }
            ]} />
        </div>
        {(['dropsets', 'isometrics'] as const).map(type => (s[type] || []).map((item: any, index: number) => (
            <div key={item.id || `${type}-${index}`} className={`workout-special-set ${type}`}>
                <div className="workout-special-heading"><span>{type === 'dropsets' ? 'Dropset' : 'Isometria'} {index + 1}</span><button type="button" className="btn-icon text-danger" onClick={() => onRemoveSpecialSet(s.id, type, index)} aria-label={`Rimuovi ${type === 'dropsets' ? 'dropset' : 'isometria'} ${index + 1} della serie ${sIndex + 1}`}><Trash2 size={20} aria-hidden="true" /></button></div>
                <div className="workout-special-fields"><label className="workout-set-field"><span>kg</span><BufferedInput id={`${type === 'dropsets' ? 'ds' : 'iso'}-kg-${s.id}-${index}`} type="number" inputMode="decimal" step="0.25" placeholder="Kg" value={item.kg ?? ''} onChange={value => onUpdateSpecialSet(s.id, type, index, 'kg', value)} onFocus={e => e.target.select()} /></label><label className="workout-set-field"><span>{type === 'dropsets' ? 'Ripetizioni' : 'Secondi'}</span><BufferedInput id={`${type === 'dropsets' ? 'ds-reps' : 'iso-time'}-${s.id}-${index}`} type="number" inputMode="numeric" placeholder={type === 'dropsets' ? 'Reps' : 'Sec'} value={(type === 'dropsets' ? item.reps : item.time) ?? ''} onChange={value => onUpdateSpecialSet(s.id, type, index, type === 'dropsets' ? 'reps' : 'time', value)} onFocus={e => e.target.select()} /></label></div>
            </div>
        )))}
    </div>
);

export const SessionSetRow = React.memo(SessionSetRowInner, (prev, next) => prev.set === next.set && prev.sIndex === next.sIndex && prev.exIndex === next.exIndex && prev.trackingType === next.trackingType && prev.isOpenMenu === next.isOpenMenu);
export default SessionSetRow;
