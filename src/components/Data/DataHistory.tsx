import React from 'react';
import { CalendarDays, Moon, Percent, Pencil, Ruler, Scale, Trash2 } from 'lucide-react';
import { Logic } from '../../lib/logic';
import { ContextMenu } from '../UI/ContextMenu';

interface DataHistoryProps {
    measurementsHistory: any[];
    editingDate: string | null;
    onSelectEdit: (day: any) => void;
    onDeleteMeasurement: (date: string) => void;
}

const DataHistory: React.FC<DataHistoryProps> = ({
    measurementsHistory,
    editingDate,
    onSelectEdit,
    onDeleteMeasurement
}) => {
    return (
        <div className="data-history-view">
            <header className="page-header page-header--compact">
                <div>
                    <span className="page-header__eyebrow">Progressi</span>
                    <h1 className="page-header__title">Storico misurazioni</h1>
                    <p className="page-header__description">
                        {measurementsHistory.length} {measurementsHistory.length === 1 ? 'rilevazione registrata' : 'rilevazioni registrate'} nel tuo diario corporeo.
                    </p>
                </div>
            </header>

            {measurementsHistory.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state__icon"><Ruler size={22} aria-hidden="true" /></div>
                    <h2>Nessuna misurazione</h2>
                    <p>Le rilevazioni di peso, massa grassa e circonferenze compariranno qui.</p>
                </div>
            ) : (
                <div className="history-list">
                    {measurementsHistory.map((day: any, idx: number) => {
                        const isEditing = editingDate === day.date;
                        return (
                            <article
                                key={day.date ? `${day.date}-${day.measurementTime || ''}-${idx}` : `hist-${idx}`}
                                className={`history-entry ${isEditing ? 'is-active' : ''}`}
                                onClick={() => onSelectEdit(day)}
                            >
                                <div className="history-entry__main">
                                    <div className="history-entry__date">
                                        <CalendarDays size={16} aria-hidden="true" />
                                        <span>{Logic.formatItalianDate ? Logic.formatItalianDate(day.date) : day.date}</span>
                                        {day.measurementTime && <span className="history-entry__time">· {day.measurementTime}</span>}
                                    </div>
                                    <div className="history-entry__metrics">
                                        {day.weight && (
                                            <span className="history-metric history-metric--primary">
                                                <Scale size={14} aria-hidden="true" /><strong>{day.weight} kg</strong>
                                            </span>
                                        )}
                                        {day.bf && (
                                            <span className="history-metric">
                                                <Percent size={14} aria-hidden="true" /><strong>{day.bf}% BF</strong>
                                            </span>
                                        )}
                                        {day.waist && <span className="history-metric">Vita {day.waist} cm</span>}
                                        {day.neck && <span className="history-metric">Collo {day.neck} cm</span>}
                                        {day.hip && <span className="history-metric">Fianchi {day.hip} cm</span>}
                                        {day.sleepHours && (
                                            <span className="history-metric">
                                                <Moon size={14} aria-hidden="true" />{Logic.formatSleepTime(day.sleepHours)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="history-entry__menu" onClick={(event) => event.stopPropagation()}>
                                    <ContextMenu
                                        items={[
                                            {
                                                label: 'Modifica',
                                                icon: <Pencil size={16} />,
                                                onClick: () => onSelectEdit(day)
                                            },
                                            {
                                                label: 'Elimina',
                                                icon: <Trash2 size={16} />,
                                                onClick: () => onDeleteMeasurement(day.date),
                                                variant: 'danger' as const
                                            }
                                        ]}
                                    />
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default DataHistory;
