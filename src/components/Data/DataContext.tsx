import { Pencil, Save, Trash2, X } from 'lucide-react';
import { shiftDateString } from '../../lib/utils/date';
import { Logic } from '../../lib/logic';
import { CONTEXT_EVENT_TYPES, contextEventTypeLabel, useContextTimeline } from '../../hooks/useContextTimeline';

export default function DataContext() {
    const context = useContextTimeline();
    const isToday = context.selectedDate === context.today;

    return (
        <div className="data-context-view">
            <section className="section-divider" aria-labelledby="context-title">
                <h2 id="context-title">Contesto e interventi</h2>
                <p className="text-sm text-muted">
                    Registra eventi che aiutano a interpretare lo storico. Sono annotazioni descrittive: non generano automaticamente modifiche a volume, carichi, cardio o nutrizione.
                </p>

                <nav className="activity-date-nav" aria-label="Giorno contesto">
                    <button type="button" className="btn btn-small" onClick={() => context.setSelectedDate(shiftDateString(context.selectedDate, -1))} disabled={context.editingId !== null}>◀ Prec.</button>
                    <button type="button" className="data-day-current" onClick={() => context.setSelectedDate(context.today)} aria-label="Torna a oggi" disabled={context.editingId !== null}>
                        <strong>{Logic.formatItalianDate(context.selectedDate)}</strong>
                        {isToday && <span>OGGI</span>}
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => !isToday && context.setSelectedDate(shiftDateString(context.selectedDate, 1))} disabled={isToday || context.editingId !== null}>Succ. ▶</button>
                </nav>

                <div className="card" style={{ margin: '12px 0 0', padding: '14px', display: 'grid', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '10px' }}>
                        <label className="text-sm">Tipo
                            <select value={context.type} onChange={event => context.setType(event.target.value as any)} style={{ width: '100%', minHeight: '44px', fontSize: '16px', marginTop: '4px' }}>
                                {CONTEXT_EVENT_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                        </label>
                        <label className="text-sm">Titolo
                            <input type="text" value={context.label} onChange={event => context.setLabel(event.target.value)} placeholder="Es. Rientro dopo 12 giorni di pausa" style={{ width: '100%', minHeight: '44px', fontSize: '16px', marginTop: '4px' }} />
                        </label>
                    </div>
                    <label className="text-sm">Nota opzionale
                        <textarea rows={3} value={context.note} onChange={event => context.setNote(event.target.value)} placeholder="Cosa è cambiato e perché può essere rilevante nello storico" style={{ width: '100%', fontSize: '16px', marginTop: '4px', boxSizing: 'border-box' }} />
                    </label>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {context.editingId && <button type="button" className="btn" onClick={context.resetForm}><X size={18} aria-hidden="true" /> Annulla modifica</button>}
                        <button type="button" className="btn btn-primary" onClick={() => void context.saveEvent()}><Save size={18} aria-hidden="true" /> {context.editingId ? 'Salva modifica' : 'Aggiungi evento'}</button>
                    </div>
                </div>

                <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
                    {context.eventsForSelectedDate.length === 0 ? (
                        <p className="text-sm text-muted">Nessun evento di contesto registrato per questo giorno.</p>
                    ) : context.eventsForSelectedDate.map(event => (
                        <article key={event.id} className="card" style={{ margin: 0, padding: '12px', display: 'grid', gap: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                                <div style={{ minWidth: 0 }}>
                                    <span className="text-xs text-muted">{contextEventTypeLabel(event.type)}</span>
                                    <strong style={{ display: 'block' }}>{event.label}</strong>
                                    {event.note && <p className="text-sm text-muted" style={{ margin: '4px 0 0' }}>{event.note}</p>}
                                </div>
                                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                    <button type="button" className="btn-icon" aria-label="Modifica evento" onClick={() => context.startEdit(event)}><Pencil size={18} /></button>
                                    <button type="button" className="btn-icon text-danger" aria-label="Elimina evento" onClick={() => void context.deleteEvent(event.id)}><Trash2 size={18} /></button>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className="section-divider" aria-labelledby="context-history-title">
                <h2 id="context-history-title">Timeline recente</h2>
                <p className="text-sm text-muted">Gli eventi restano separati dai dati osservati: servono a dare contesto alle variazioni nello storico.</p>
                <div style={{ display: 'grid', gap: '8px' }}>
                    {context.recentEvents.length === 0 ? (
                        <p className="text-sm text-muted">Nessun evento di contesto registrato.</p>
                    ) : context.recentEvents.map(({ date, event }) => (
                        <button
                            type="button"
                            key={date + ':' + event.id}
                            className="card"
                            onClick={() => context.setSelectedDate(date)}
                            style={{ margin: 0, padding: '12px', textAlign: 'left', color: 'inherit', width: '100%' }}
                        >
                            <span className="text-xs text-muted">{Logic.formatItalianDate(date)} · {contextEventTypeLabel(event.type)}</span>
                            <strong style={{ display: 'block' }}>{event.label}</strong>
                            {event.note && <span className="text-sm text-muted">{event.note}</span>}
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}
