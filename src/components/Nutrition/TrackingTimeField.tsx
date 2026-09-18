import { X } from 'lucide-react';
import './TrackingViews.css';

interface TrackingTimeFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    clearLabel: string;
    placeholder?: string;
}

export function TrackingTimeField({ id, label, value, onChange, clearLabel, placeholder }: TrackingTimeFieldProps) {
    return <div className="tracking-field tracking-field--time">
        <label htmlFor={id}>{label}</label>
        <div className="tracking-time-input">
            <input id={id} type="time" placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} onFocus={event => event.target.select()} />
            {value && <button type="button" className="btn-icon" aria-label={clearLabel} onClick={() => onChange('')}><X size={20} aria-hidden="true" /></button>}
        </div>
    </div>;
}
