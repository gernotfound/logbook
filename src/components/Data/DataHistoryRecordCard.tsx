import { useState } from 'react';
import { ChevronRight, Pencil, Ruler, Trash2 } from 'lucide-react';
import { Logic } from '../../lib/logic';
import type { MeasurementHistoryDay } from '../../types';
import { ContextMenu } from '../UI/ContextMenu';
import DataHistoryDetail from './DataHistoryDetail';
import { hasMeasurementData, recordSummary } from './dataHistoryFormatting';

interface DataHistoryRecordCardProps {
    day: MeasurementHistoryDay;
    editingDate: string | null;
    canOpenDetail: boolean;
    onSelectEdit: (day: MeasurementHistoryDay) => void;
    onDeleteMeasurement?: (date: string) => void;
}

export default function DataHistoryRecordCard({
    day, editingDate, canOpenDetail, onSelectEdit, onDeleteMeasurement,
}: DataHistoryRecordCardProps) {
    // The detail belongs to this mounted record. Removing/replacing the record
    // unmounts the dialog, so a later sync cannot resurrect an obsolete intent.
    const [detailOpen, setDetailOpen] = useState(false);
    const measurement = hasMeasurementData(day);
    const title = measurement
        ? `Misurazione${day.measurementTime ? ' · ' + day.measurementTime : ''}`
        : 'Dati giornalieri';

    return (
        <>
            <article className={`history-record-card${editingDate === day.date ? ' editing' : ''}`}>
                <button
                    className="history-record-open"
                    type="button"
                    aria-label={`Apri dettaglio del ${Logic.formatItalianDate(day.date)}`}
                    disabled={!canOpenDetail}
                    onClick={() => setDetailOpen(true)}
                >
                    <span className="history-record-icon" aria-hidden="true"><Ruler size={20} /></span>
                    <span className="history-record-copy">
                        <span className="history-record-name">{title}</span>
                        <span className="history-record-info">{recordSummary(day)}</span>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                </button>
                {canOpenDetail && (
                    <div className="history-record-menu">
                        <ContextMenu items={[
                            {
                                label: 'Vedi dettaglio',
                                icon: <Ruler size={16} />,
                                onClick: event => {
                                    // Keep a surviving trigger when the menu closes.
                                    event.currentTarget.closest('.history-record-card')
                                        ?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
                                        ?.focus({ preventScroll: true });
                                    setDetailOpen(true);
                                },
                            },
                            {
                                label: 'Modifica misurazione',
                                icon: <Pencil size={16} />,
                                hidden: !measurement,
                                onClick: () => onSelectEdit(day),
                            },
                            {
                                label: 'Elimina misurazione',
                                icon: <Trash2 size={16} />,
                                variant: 'danger',
                                hidden: !measurement || !onDeleteMeasurement,
                                onClick: () => onDeleteMeasurement?.(day.date),
                            },
                        ]} />
                    </div>
                )}
            </article>
            {detailOpen && canOpenDetail && (
                <DataHistoryDetail
                    day={day}
                    onClose={() => setDetailOpen(false)}
                    onSelectEdit={onSelectEdit}
                />
            )}
        </>
    );
}
