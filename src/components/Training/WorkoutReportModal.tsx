import { dispatchDurableOperation } from '../../lib/sync/dispatchDurableOperation';
import { routineFromWorkout } from '../../lib/calc/routineFromWorkout';
import { Logic } from '../../lib/logic';
import { useAppStore } from '../../store/useAppStore';
import type { WorkoutSession, Exercise } from '../../types';
import { WorkoutReportView } from './report/WorkoutReportView';

interface WorkoutReportModalProps {
    workout: WorkoutSession;
    history: WorkoutSession[];
    library: Exercise[];
    onClose: () => void;
    fromEndWorkout?: boolean;
}

/** Guest/legacy adapter: the shared report receives its writer and context explicitly. */
const WorkoutReportModal = (props: WorkoutReportModalProps) => {
    const nutrition = useAppStore(state => state.userData?.nutrition);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const saveAsRoutine = async (name: string) => {
        const routine = routineFromWorkout(props.workout, Logic.generateId('r'), name);
        await dispatchDurableOperation(dispatchDomainOperation, { type: 'routine.upsert', routine });
    };
    return <WorkoutReportView {...props} nutrition={nutrition} onSaveAsRoutine={saveAsRoutine} />;
};

export default WorkoutReportModal;
