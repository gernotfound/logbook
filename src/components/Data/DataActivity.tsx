import { Footprints, HeartPulse, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import { CARDIO_INTENSITIES, CARDIO_MODALITIES, CARDIO_STRUCTURES, cardioIntensityLabel, cardioModalityLabel } from '../../lib/activity';
import { Logic } from '../../lib/logic';
import { shiftDateString } from '../../lib/utils/date';

const integerFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });

export default function DataActivity() {
    const activity = useActivityTracking();
    const week = activity.currentWeek;
    const activeDate = activity.selectedDate;
    const isToday = activeDate === activity.today;
    const form = activity.cardioForm;

    const previousDay = () => activity.setSelectedDate(shiftDateString(activeDate, -1));
    const nextDay = () => { if (!isToday) activity.setSelectedDate(shiftDateString(activeDate, 1)); };

    return (
        <div className="activity-view">
            <section className="section-divider activity-summary" aria-labelledby="activity-week-title">
                <div className="activity-heading-row">
                    <div>
                        <h2 id="activity-week-title">Attività — questa settimana</h2>
                        <p>Dati registrati, senza stime di consumo o prescrizioni.</p>
                    </div>
                    <HeartPulse size={22} aria-hidden="true" />
                </div>                <div className="activity-stat-grid">
                    <div className="activity-stat"><span>Passi medi</span><strong>{week.averageSteps === null ? '—' : integerFormatter.format(week.averageSteps)}</strong></div>
                    <div className="activity-stat"><span>Dati passi</span><strong>{week.stepDaysCount}/{week.daysConsidered} giorni</strong></div>
                    <div className="activity-stat"><span>Passi registrati</span><strong>{week.stepDaysCount ? integerFormatter.format(week.totalSteps) : '—'}</strong></div>
                    <div className="activity-stat"><span>Cardio registrato</span><strong>{decimalFormatter.format(week.cardioMinutes)} min</strong></div>
                    <div className="activity-stat"><span>Sessioni cardio</span><strong>{week.cardioSessionsCount}</strong></div>
                </div>
                {week.cardioSessionsCount > 0 && (
                    <div className="activity-intensity-summary" aria-label="Minuti cardio per intensità">
                        <span>Bassa {decimalFormatter.format(week.cardioMinutesByIntensity.low)} min</span>
                        <span>Moderata {decimalFormatter.format(week.cardioMinutesByIntensity.moderate)} min</span>
                        <span>Alta {decimalFormatter.format(week.cardioMinutesByIntensity.high)} min</span>
                        {week.cardioMinutesByIntensity.unclassified > 0 && <span>Senza intensità {decimalFormatter.format(week.cardioMinutesByIntensity.unclassified)} min</span>}
                    </div>
                )}
            </section>

            <nav className="activity-date-nav" aria-label="Giorno attività">
                <button type="button" className="btn btn-small" onClick={previousDay}>◀ Prec.</button>
                <button type="button" className="data-day-current" onClick={() => activity.setSelectedDate(activity.today)} aria-label="Torna a oggi">
                    <strong>{Logic.formatItalianDate(activeDate)}</strong>
                    {isToday && <span>OGGI</span>}
                </button>
                <button type="button" className="btn btn-small" onClick={nextDay} disabled={isToday}>Succ. ▶</button>
            </nav>            <section className="section-divider" aria-labelledby="daily-activity-title">
                <div className="activity-heading-row">
                    <div>
                        <h2 id="daily-activity-title"><Footprints size={20} aria-hidden="true" /> Attività quotidiana</h2>
                        <p>Registra i passi della giornata. I passi non vengono trattati come sinonimo di NEAT.</p>
                    </div>
                    {activity.savedSteps !== undefined && <strong className="activity-saved-value">{integerFormatter.format(activity.savedSteps)} passi</strong>}
                </div>
                <div className="activity-steps-form">
                    <label htmlFor="activity-steps">Passi</label>
                    <input
                        id="activity-steps"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        placeholder="Es. 9842"
                        value={activity.steps}
                        onChange={event => activity.setSteps(event.target.value)}
                    />
                    <button type="button" className="btn btn-primary activity-action" onClick={activity.saveSteps}><Save size={18} aria-hidden="true" /> Salva</button>
                    {activity.savedSteps !== undefined && (
                        <button type="button" className="btn activity-action" onClick={activity.clearSteps}>Rimuovi dato</button>
                    )}
                </div>
            </section>

            <section className="section-divider" aria-labelledby="cardio-today-title">
                <div className="activity-heading-row activity-cardio-header">
                    <div>
                        <h2 id="cardio-today-title">Cardio del giorno</h2>
                        <p>Sessioni autonome, separate dagli esercizi cardio inseriti negli allenamenti.</p>
                    </div>
                    <button type="button" className="btn btn-primary activity-action" onClick={activity.startNewCardio} disabled={activity.editingCardioId !== null}>
                        <Plus size={18} aria-hidden="true" /> Aggiungi cardio
                    </button>
                </div>                {activity.cardioSessions.length === 0 ? (
                    <p className="activity-empty">Nessuna sessione cardio registrata per questo giorno.</p>
                ) : (
                    <div className="activity-cardio-list">
                        {activity.cardioSessions.map(session => {
                            const intensity = cardioIntensityLabel(session.intensity);
                            const start = session.startedAt ? new Date(session.startedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null;
                            return (
                                <article className="activity-cardio-item" key={session.id}>
                                    <div className="activity-cardio-copy">
                                        <strong>{cardioModalityLabel(session.modality)}</strong>
                                        <span>
                                            {session.durationMinutes} min
                                            {intensity ? ' · Intensità ' + intensity.toLowerCase() : ''}
                                            {session.averageHeartRate !== undefined ? ' · ' + session.averageHeartRate + ' bpm' : ''}
                                            {session.distanceKm !== undefined ? ' · ' + decimalFormatter.format(session.distanceKm) + ' km' : ''}
                                        </span>
                                        {(start || session.notes) && <small>{start ? 'Ore ' + start : ''}{start && session.notes ? ' · ' : ''}{session.notes ?? ''}</small>}
                                    </div>
                                    <div className="activity-cardio-actions">
                                        <button type="button" className="activity-icon-btn" aria-label={'Modifica ' + cardioModalityLabel(session.modality)} onClick={() => activity.editCardio(session.id)} disabled={activity.editingCardioId !== null}><Pencil size={18} /></button>
                                        <button type="button" className="activity-icon-btn" aria-label={'Elimina ' + cardioModalityLabel(session.modality)} onClick={() => activity.deleteCardio(session.id)}><Trash2 size={18} /></button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}                {activity.editingCardioId !== null && (
                    <form className="activity-cardio-editor" onSubmit={event => { event.preventDefault(); void activity.saveCardio(); }}>
                        <div className="activity-editor-title">
                            <h3>{activity.editingCardioId === 'new' ? 'Nuova sessione cardio' : 'Modifica sessione cardio'}</h3>
                            <button type="button" className="activity-icon-btn" aria-label="Chiudi modulo cardio" onClick={activity.cancelCardio}><X size={20} /></button>
                        </div>
                        <div className="activity-primary-fields">
                            <label>Modalità
                                <select value={form.modality} onChange={event => activity.setCardioField('modality', event.target.value)} required>
                                    <option value="">Seleziona</option>
                                    {CARDIO_MODALITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                </select>
                            </label>
                            <label>Durata (min)
                                <input type="number" inputMode="numeric" min="1" max="1440" step="1" value={form.durationMinutes} onChange={event => activity.setCardioField('durationMinutes', event.target.value)} required />
                            </label>
                            <label>Intensità
                                <select value={form.intensity} onChange={event => activity.setCardioField('intensity', event.target.value)} required>
                                    <option value="">Seleziona</option>
                                    {CARDIO_INTENSITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                </select>
                            </label>
                        </div>
                        <details className="activity-details">
                            <summary>Dettagli opzionali</summary>
                            <div className="activity-detail-fields">
                                <label>Struttura
                                    <select value={form.structure} onChange={event => activity.setCardioField('structure', event.target.value)}>
                                        <option value="">Non specificata</option>
                                        {CARDIO_STRUCTURES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                    </select>
                                </label>                                <label>Frequenza cardiaca media (bpm)
                                    <input type="number" inputMode="numeric" min="1" max="300" step="1" value={form.averageHeartRate} onChange={event => activity.setCardioField('averageHeartRate', event.target.value)} />
                                </label>
                                <label>Distanza (km)
                                    <input type="text" inputMode="decimal" placeholder="Es. 2,1" value={form.distanceKm} onChange={event => activity.setCardioField('distanceKm', event.target.value)} />
                                </label>
                                <label>Ora di inizio
                                    <input type="time" value={form.startTime} onChange={event => activity.setCardioField('startTime', event.target.value)} />
                                </label>
                                <label className="activity-notes-field">Note
                                    <textarea rows={3} value={form.notes} onChange={event => activity.setCardioField('notes', event.target.value)} placeholder="Facoltative" />
                                </label>
                            </div>
                        </details>
                        <div className="activity-editor-actions">
                            <button type="button" className="btn activity-action" onClick={activity.cancelCardio}>Annulla</button>
                            <button type="submit" className="btn btn-primary activity-action"><Save size={18} aria-hidden="true" /> Salva cardio</button>
                        </div>
                    </form>
                )}
            </section>
        </div>
    );
}
