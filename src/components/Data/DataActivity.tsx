import { Footprints, Save } from 'lucide-react';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import { shiftDateString } from '../../lib/utils/date';
import DataDateNavigator from './DataDateNavigator';
import { ActivityOverview } from './activity/ActivityOverview';
import { ActivityCardioSection } from './activity/ActivityCardioSection';

const integerFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

export default function DataActivity() {
    const activity = useActivityTracking();
    const activeDate = activity.selectedDate;
    const isToday = activeDate === activity.today;
    const dateNavigationLocked = activity.editingCardioId !== null;

    const previousDay = () => activity.setSelectedDate(shiftDateString(activeDate, -1));
    const nextDay = () => { if (!isToday) activity.setSelectedDate(shiftDateString(activeDate, 1)); };

    return (
        <div className="activity-view data-page-grid">
            <DataDateNavigator
                date={activeDate}
                today={activity.today}
                onPrevious={previousDay}
                onNext={nextDay}
                onToday={() => activity.setSelectedDate(activity.today)}
                disabled={dateNavigationLocked}
                label="Giorno attività"
            />
            <ActivityOverview currentWeek={activity.currentWeek} trainingActivityContext={activity.trainingActivityContext} />

            <section className="section-divider" aria-labelledby="daily-activity-title">
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

            <ActivityCardioSection activity={activity} />
        </div>
    );
}
