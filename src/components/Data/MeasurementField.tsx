import React from 'react';

interface MeasurementFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (val: string) => void;
    step?: string;
    placeholder?: string;
    isPrimary?: boolean;
}

export const MeasurementField: React.FC<MeasurementFieldProps> = ({ id, label, value, onChange, step = "0.1", placeholder, isPrimary }) => {
    return (
        <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>{label}</label>
            <input 
                id={id} 
                type="number" 
                inputMode="decimal"
                step={step} 
                placeholder={placeholder}
                value={value} 
                onChange={e => onChange(e.target.value)} 
                onFocus={e => e.target.select()}
                style={{ 
                    width: '100%', 
                    boxSizing: 'border-box', 
                    textAlign: 'center', 
                    margin: '0 auto', 
                    fontSize: '16px',
                    ...(isPrimary ? {
                        fontWeight: 'bold',
                        padding: '10px',
                        lineHeight: 1,
                        marginBottom: '4px' // adjusting label margin logic
                    } : {})
                }}
            />
        </div>
    );
};
