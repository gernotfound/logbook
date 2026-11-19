import type { MuscleModelPathProps } from './muscleModelPaths/types';
import FrontUpperPaths from './muscleModelPaths/FrontUpperPaths';
import FrontLowerPaths from './muscleModelPaths/FrontLowerPaths';
import BackUpperPaths from './muscleModelPaths/BackUpperPaths';
import BackLowerPaths from './muscleModelPaths/BackLowerPaths';

export default function MuscleModelPaths(props: MuscleModelPathProps) {
    return (
        <>
            <FrontUpperPaths {...props} />
            <FrontLowerPaths {...props} />
            <BackUpperPaths {...props} />
            <BackLowerPaths {...props} />
        </>
    );
}
