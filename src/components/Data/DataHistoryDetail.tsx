import { useId, useRef } from 'react';
import { Pencil, X } from 'lucide-react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { useScrollLock } from '../../hooks/useScrollLock';
import { formatSleepTime } from '../../lib/utils/date';
import type { MeasurementHistoryDay } from '../../types';
import { dayLabel } from '../../lib/utils/historyCalendar';
import { formatDecimal, hasFiniteValue, hasMeasurementData } from './dataHistoryFormatting';

interface DataHistoryDetailProps {
    day: MeasurementHistoryDay;
    onClose: () => void;
    onSelectEdit: (day: MeasurementHistoryDay) => void;
}

// Mount the modal lifecycle only while open so focus returns to its actual trigger.
export default function DataHistoryDetail({ day, onClose, onSelectEdit }: DataHistoryDetailProps) {
    const titleId = useId();
    const dialogRef = useRef<HTMLElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const formattedSleep = formatSleepTime(day.sleepHours);
    useScrollLock();
    useModalFocusTrap({ containerRef: dialogRef, initialFocusRef: closeButtonRef, onEscape: onClose });

    return (
        <div className="data-detail-layer">
            <button
                className="data-detail-backdrop"
                tabIndex={-1}
                type="button"
                onClick={onClose}
                aria-label="Chiudi dettaglio"
            />
            <section ref={dialogRef} className="data-detail-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
                <div className="data-detail-head">
                    <div>
                        <h2 id={titleId}>Dettaglio dati</h2>
                        <p>
                            {dayLabel(day.date)}
                            {day.measurementTime ? ` · ${day.measurementTime}` : ''}
                        </p>
                    </div>
                    <button ref={closeButtonRef} type="button" className="data-icon-button" onClick={onClose} aria-label="Chiudi dettaglio">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                <div className="data-detail-scroll">
                    <div className="data-detail-grid">
                    {hasFiniteValue(day.weight) && <div><strong>{formatDecimal(Number(day.weight))} kg</strong><span>Peso</span></div>}
                    {hasFiniteValue(day.bf) && <div><strong>{formatDecimal(Number(day.bf))}%</strong><span>BF · {day.bfProvenance?.method === 'us_navy' ? 'US Navy' : 'origine n.d.'}</span></div>}
                    {hasFiniteValue(day.waist) && <div><strong>{formatDecimal(Number(day.waist))} cm</strong><span>Vita</span></div>}
                    {hasFiniteValue(day.neck) && <div><strong>{formatDecimal(Number(day.neck))} cm</strong><span>Collo</span></div>}
                    {hasFiniteValue(day.hip) && <div><strong>{formatDecimal(Number(day.hip))} cm</strong><span>Fianchi</span></div>}
                    {hasFiniteValue(day.chest) && <div><strong>{formatDecimal(Number(day.chest))} cm</strong><span>Torace</span></div>}
                    {hasFiniteValue(day.shoulders) && <div><strong>{formatDecimal(Number(day.shoulders))} cm</strong><span>Spalle</span></div>}
                    {hasFiniteValue(day.biceps) && <div><strong>{formatDecimal(Number(day.biceps))} cm</strong><span>Braccia</span></div>}
                    {hasFiniteValue(day.thighs) && <div><strong>{formatDecimal(Number(day.thighs))} cm</strong><span>Cosce</span></div>}
                    {hasFiniteValue(day.calves) && <div><strong>{formatDecimal(Number(day.calves))} cm</strong><span>Polpacci</span></div>}
                    {formattedSleep && <div><strong>{formattedSleep}</strong><span>Sonno</span></div>}
                    </div>
                </div>
                <div className="data-action-row">
                    <button type="button" className="btn" onClick={onClose}>Chiudi</button>
                    {hasMeasurementData(day) && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                                onClose();
                                onSelectEdit(day);
                            }}
                        >
                            <Pencil size={16} aria-hidden="true" /> Modifica
                        </button>
                    )}
                </div>
            </section>
        </div>
    );
}
