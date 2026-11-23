import { useId, useMemo, useRef, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useLocalToday } from '../../hooks/useLocalToday';
import { captureActivitySteps } from '../../lib/activity';
import { computeWeeklyActivitySeries, computeWeeklyTrainingActivityContext } from '../../lib/calc/analytics';
import { Logic } from '../../lib/logic';
import type { UserData } from '../../types';
import { ActivityOverview } from './activity/ActivityOverview';
import { KindeCandidateCardio } from './KindeCandidateCardio';
import { KindeCandidateSteps } from './KindeCandidateSteps';
import './data.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;
type Editor = 'steps' | 'cardio';
export type ActivityEditorAccess = {
    disabled: boolean;
    claim: () => boolean;
    release: () => void;
};

export function KindeCandidateActivity({ realm }: { realm: Realm }) {
    const today = useLocalToday();
    const [selected, setSelected] = useState<string | null>(null);
    if (realm.state.phase !== 'ready') return null;
    const date = selected ?? today;
    return <ActivityDay key={date} realm={realm} data={realm.state.snapshot.data}
        date={date} today={today} select={setSelected} />;
}

function ActivityDay({ realm, data, date, today, select }: {
    realm: Realm;
    data: UserData;
    date: string;
    today: string;
    select: (date: string) => void;
}) {
    const dateInput = useId();
    const active = useRef<Editor | null>(null);
    const [locked, setLocked] = useState<Editor | null>(null);
    const access = (editor: Editor): ActivityEditorAccess => ({
        disabled: !date || date > today || (locked !== null && locked !== editor),
        claim: () => {
            if (!date || date > today || active.current !== null) return false;
            active.current = editor;
            setLocked(editor);
            return true;
        },
        release: () => {
            if (active.current !== editor) return;
            active.current = null;
            setLocked(null);
        },
    });
    const { nutrition, history, library } = data;
    const overview = useMemo(() => {
        const days = nutrition ?? {};
        return {
            currentWeek: computeWeeklyActivitySeries(days, 1, today).points[0],
            trainingActivityContext: computeWeeklyTrainingActivityContext(
                history ?? [], days, library ?? [], Logic.getLatestUserWeight(days), 8, today,
            ),
        };
    }, [nutrition, history, library, today]);
    const day = nutrition?.[date];

    return (
        <section className="kinde-candidate-activity" aria-label="Attività account">
            <div className="activity-view data-page-grid">
                <div className="activity-steps-form">
                    <label htmlFor={dateInput}>Giorno attività</label>
                    <input id={dateInput} type="date" value={date} max={today} disabled={locked !== null}
                        onChange={event => { if (active.current === null) select(event.target.value); }} />
                </div>
                <ActivityOverview {...overview} />
                <KindeCandidateSteps realm={realm} date={date} saved={captureActivitySteps(day)} access={access('steps')} />
                <KindeCandidateCardio realm={realm} date={date} sessions={day?.cardioSessions} access={access('cardio')} />
            </div>
        </section>
    );
}
