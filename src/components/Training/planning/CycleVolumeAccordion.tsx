import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CycleMacroVolumeItem } from './cycleMacroVolume';

interface CycleVolumeAccordionProps {
    items: CycleMacroVolumeItem[];
    defaultOpen?: boolean;
}

export function CycleVolumeAccordion({ items, defaultOpen = false }: CycleVolumeAccordionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const maxSets = Math.max(1, ...items.map(item => item.sets));

    return (
        <section className="planning-volume" aria-label="Volume settimanale per macroarea">
            <button
                type="button"
                className="planning-accordion"
                aria-expanded={isOpen}
                aria-label="Volume settimanale per muscolo, per macroarea"
                onClick={() => setIsOpen(open => !open)}
            >
                <span>Volume settimanale per macroarea</span>
                <ChevronDown className={isOpen ? 'is-open' : ''} size={20} aria-hidden="true" />
            </button>
            {isOpen ? (
                <div className="planning-accordion-panel">
                    <p className="planning-helper">
                        Le porzioni dello stesso esercizio confluiscono una sola volta nella relativa macroarea.
                    </p>
                    {items.length === 0 ? (
                        <p className="planning-empty-copy">Nessun volume disponibile per le schede del ciclo.</p>
                    ) : (
                        <div className="planning-volume-list">
                            {items.map(item => (
                                <div key={item.key} className="planning-volume-row">
                                    <strong>{item.label}</strong>
                                    <span className="planning-volume-track" aria-hidden="true">
                                        <span style={{ width: `${Math.max(6, (item.sets / maxSets) * 100)}%` }} />
                                    </span>
                                    <span>{item.sets}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : null}
        </section>
    );
}
