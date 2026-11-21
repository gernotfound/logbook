import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import type { useActivityTracking } from '../../../hooks/useActivityTracking';
import {
    CARDIO_INTENSITIES, CARDIO_MODALITIES, CARDIO_STRUCTURES,
    cardioIntensityLabel, cardioModalityLabel, timestampToLocalTime,
} from '../../../lib/activity';

type ActivityCardioProps = Pick<ReturnType<typeof useActivityTracking>,
    'cardioForm' | 'cardioSessions' | 'editingCardioId' | 'isCreatingCardio'
    | 'startNewCardio' | 'editCardio' | 'deleteCardio'
    | 'setCardioField' | 'cancelCardio' | 'saveCardio'>;

const decimalFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });

export function ActivityCardioSection({ activity }: { activity: ActivityCardioProps }) {
    const form = activity.cardioForm;
    return (
        <section className="section-divider" aria-labelledby="cardio-today-title">
            <div className="activity-heading-row activity-cardio-header">
                <div>
                    <h2 id="cardio-today-title">Cardio del giorno</h2>
                    <p>Sessioni autonome, separate dagli esercizi cardio inseriti negli allenamenti.</p>
                </div>
                <button type="button" className="btn btn-primary activity-action" onClick={activity.startNewCardio} disabled={activity.editingCardioId !== null}>
                    <Plus size={18} aria-hidden="true" /> Aggiungi cardio
                </button>
            </div>
            {activity.cardioSessions.length === 0 ? (
                <p className="activity-empty">Nessuna sessione cardio registrata per questo giorno.</p>
            ) : (
                <div className="activity-cardio-list">
                    {activity.cardioSessions.map(session => {
                        const intensity = cardioIntensityLabel(session.intensity);
                        const start = timestampToLocalTime(session.startedAt);
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
                        <h3>{activity.isCreatingCardio ? 'Nuova sessione cardio' : 'Modifica sessione cardio'}</h3>
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
                        <summary className="disclosure-summary">Dettagli opzionali</summary>
                        <div className="activity-detail-fields">
                            <label>Struttura
                                <select value={form.structure} onChange={event => activity.setCardioField('structure', event.target.value)}>
                                    <option value="">Non specificata</option>
                                    {CARDIO_STRUCTURES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                </select>
                            </label>
                            <label>Frequenza cardiaca media (bpm)
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
    );
}
