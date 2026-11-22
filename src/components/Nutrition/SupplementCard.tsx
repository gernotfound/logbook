import { Copy, Pencil, Trash2 } from 'lucide-react';
import type { Supplement, SupplementIntake } from '../../types';
import { ContextMenu } from '../UI/ContextMenu';

interface SupplementCardProps {
    supplement: Supplement;
    intakes: readonly SupplementIntake[];
    quickInput: string | undefined;
    onQuickInputChange: (value: string) => void;
    onEdit: () => void;
    onDuplicate: () => Promise<void>;
    onDelete: () => Promise<void>;
    onAddIntake: () => Promise<void>;
    onRemoveIntake: (id: string) => Promise<void>;
}

export function SupplementCard({
    supplement, intakes, quickInput, onQuickInputChange,
    onEdit, onDuplicate, onDelete, onAddIntake, onRemoveIntake,
}: SupplementCardProps) {
    const totalTaken = intakes.reduce((sum, intake) => sum + intake.amount, 0);
    const hasTarget = typeof supplement.target === 'number'
        && Number.isFinite(supplement.target) && supplement.target > 0;
    const progressPercent = hasTarget
        ? Math.min(Math.max((totalTaken / supplement.target!) * 100, 0), 100)
        : 0;

    return (
        <article className="card mb-15" aria-label={supplement.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                    <div style={{ fontWeight: 'bold', fontSize: 'var(--font-size-control)', color: 'var(--text-main)' }}>{supplement.name}</div>
                    <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
                        Assunto: <strong style={{ color: 'var(--text-main)' }}>{Math.round(totalTaken * 10) / 10}</strong> {supplement.unit}
                        {hasTarget ? ` / ${supplement.target} ${supplement.unit}` : ''}
                    </div>
                </div>
                <ContextMenu items={[
                    { label: 'Modifica', icon: <Pencil size={16} />, onClick: onEdit },
                    { label: 'Duplica', icon: <Copy size={16} />, onClick: onDuplicate },
                    { label: 'Elimina', icon: <Trash2 size={16} />, variant: 'danger', onClick: onDelete },
                ]} />
            </div>

            {hasTarget && (
                <div className="progress-bg" style={{ height: '6px', marginBottom: '15px' }}>
                    <div className="progress-fill" style={{
                        width: `${progressPercent}%`,
                        background: progressPercent >= 100 ? 'var(--success-color)' : 'var(--primary-color)',
                    }} />
                </div>
            )}

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '15px' }}>
                <input
                    type="number"
                    inputMode="decimal"
                    placeholder={`Quantità (${supplement.unit})`}
                    aria-label={`Quantità assunzione ${supplement.name}`}
                    value={quickInput !== undefined ? quickInput : (supplement.portion ? String(supplement.portion) : '')}
                    onChange={event => onQuickInputChange(event.target.value)}
                    onFocus={event => event.target.select()}
                    style={{ margin: 0, flex: 1, appearance: 'none', WebkitAppearance: 'none' }}
                />
                <button className="btn btn-primary" style={{ margin: 0, whiteSpace: 'nowrap', flex: 1 }}
                    onClick={onAddIntake}>
                    + Aggiungi
                </button>
            </div>

            {intakes.length > 0 && (
                <div style={{ background: 'var(--surface-light)', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)', marginBottom: '8px' }}>Storico odierno:</div>
                    {intakes.map(intake => {
                        const time = new Date(intake.time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                        return (
                            <div key={intake.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px dashed var(--glass-border)' }}>
                                <div style={{ fontSize: 'var(--font-size-body)' }}>
                                    <span style={{ color: 'var(--text-muted)', marginRight: '8px' }}>{time}</span>
                                    <strong>{intake.amount}</strong> {supplement.unit}
                                </div>
                                <button type="button" className="btn-icon text-danger"
                                    aria-label={`Rimuovi assunzione di ${intake.amount} ${supplement.unit} delle ${time}`}
                                    onClick={() => onRemoveIntake(intake.id)}>✕</button>
                            </div>
                        );
                    })}
                </div>
            )}
        </article>
    );
}
