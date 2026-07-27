
import MuscleModelPaths from './MuscleModelPaths';

const GROUP_MAP = {
    'abductors': ['gluteus-medius-left', 'gluteus-medius-right'],
    'abs': ['abs-lower-left', 'abs-lower-right', 'abs-upper-left', 'abs-upper-right'],
    'adductors': ['adductors-left_1', 'adductors-left_2', 'adductors-right_1', 'adductors-right_2'],
    'back': ['lats-lower-left', 'lats-lower-right', 'lats-mid-left', 'lats-mid-right', 'lats-upper-left', 'lats-upper-right', 'lower-back-erectors-left', 'lower-back-erectors-right', 'lower-back-ql-left', 'lower-back-ql-right', 'traps-lower-left', 'traps-lower-right', 'traps-mid-left', 'traps-mid-right', 'traps-upper-left', 'traps-upper-right'],
    'biceps': ['biceps-left_1', 'biceps-left_2', 'biceps-left_3', 'biceps-right_1', 'biceps-right_2', 'biceps-right_3'],
    'calves': ['calves-gastroc-lateral-left', 'calves-gastroc-lateral-right', 'calves-gastroc-medial-left', 'calves-gastroc-medial-right', 'calves-soleus-left', 'calves-soleus-right'],
    'chest': ['chest-lower-left', 'chest-lower-right', 'chest-upper-left', 'chest-upper-right'],
    'core': ['abs-lower-left', 'abs-lower-right', 'abs-upper-left', 'abs-upper-right', 'obliques-left_1', 'obliques-left_2', 'obliques-left_3', 'obliques-right_1', 'obliques-right_2', 'obliques-right_3'],
    'forearms': ['forearm-anterior-left', 'forearm-anterior-right', 'forearm-brachioradialis-left', 'forearm-brachioradialis-right', 'forearm-extensors-left', 'forearm-extensors-right', 'forearm-flexors-left', 'forearm-flexors-right'],
    'glutes': ['gluteus-maximus-left', 'gluteus-maximus-right', 'gluteus-medius-left', 'gluteus-medius-right'],
    'hamstrings': ['hamstrings-lateral-left', 'hamstrings-lateral-right', 'hamstrings-medial-left', 'hamstrings-medial-right'],
    'lats': ['lats-lower-left', 'lats-lower-right', 'lats-mid-left', 'lats-mid-right', 'lats-upper-left', 'lats-upper-right'],
    'legs': ['calves-gastroc-lateral-left', 'calves-gastroc-lateral-right', 'calves-gastroc-medial-left', 'calves-gastroc-medial-right', 'calves-soleus-left', 'calves-soleus-right', 'gluteus-maximus-left', 'gluteus-maximus-right', 'gluteus-medius-left', 'gluteus-medius-right', 'hamstrings-lateral-left', 'hamstrings-lateral-right', 'hamstrings-medial-left', 'hamstrings-medial-right', 'quads-left_1', 'quads-left_2', 'quads-left_3', 'quads-right_1', 'quads-right_2', 'quads-right_3'],
    'lower_back': ['lower-back-erectors-left', 'lower-back-erectors-right', 'lower-back-ql-left', 'lower-back-ql-right'],
    'obliques': ['obliques-left_1', 'obliques-left_2', 'obliques-left_3', 'obliques-right_1', 'obliques-right_2', 'obliques-right_3'],
    'quads': ['quads-left_1', 'quads-left_2', 'quads-left_3', 'quads-right_1', 'quads-right_2', 'quads-right_3'],
    'rhomboids': ['traps-mid-left', 'traps-mid-right'],
    'shoulders': ['deltoid-rear-left', 'deltoid-rear-right', 'shoulder-front-left_1', 'shoulder-front-left_2', 'shoulder-front-right_1', 'shoulder-front-right_2', 'shoulder-side-left_1', 'shoulder-side-left_2', 'shoulder-side-right_1', 'shoulder-side-right_2'],
    'traps': ['nape_1', 'nape_2', 'traps-lower-left', 'traps-lower-right', 'traps-mid-left', 'traps-mid-right', 'traps-upper-left', 'traps-upper-right'],
    'triceps': ['triceps-lateral-left', 'triceps-lateral-right', 'triceps-long-left', 'triceps-long-right'],
    'triceps_lateral': ['triceps-lateral-left', 'triceps-lateral-right'],
    'triceps_left': ['triceps-lateral-left', 'triceps-long-left'],
    'triceps_long': ['triceps-long-left', 'triceps-long-right'],
    'triceps_medial': ['triceps-long-left', 'triceps-long-right'],
    'triceps_right': ['triceps-lateral-right', 'triceps-long-right'],
};

export default function MuscleModel({ selectedMuscles = [] }: { selectedMuscles?: string[] }) {
    // Determine which svg path IDs should be highlighted based on selectedMuscles
    const activeSvgIds = new Set();
    selectedMuscles.forEach(muscle => {
        // Find exact match in GROUP_MAP or just use the muscle ID directly
        const mapped = (GROUP_MAP as any)[muscle];
        if (mapped) {
            mapped.forEach((id: string) => activeSvgIds.add(id));
        } else {
            activeSvgIds.add(muscle);
        }
    });

    const getPathStyle = (id: string) => {
        const isActive = activeSvgIds.has(id);
        return {
            fill: isActive ? 'var(--primary-color, #00e5ff)' : 'transparent',
            transition: 'fill 0.3s ease'
        };
    };

    return (
        <div className="muscle-map-container" style={{ display: 'flex', justifyContent: 'center', padding: '10px 0', overflowX: 'auto' }}>
            <svg viewBox="-5 -5 85 110" width="100%" style={{ maxWidth: '800px', backgroundColor: 'transparent', borderRadius: 0 }}>
                <defs>
                    <pattern id="textured_black_pattern" width="10" height="10" patternUnits="userSpaceOnUse">
                        <rect width="10" height="10" fill="#222"></rect>
                        <circle cx="5" cy="5" r="1" fill="#444"></circle>
                    </pattern>
                </defs>
                <g id="figures" stroke="#CCCCCC" strokeWidth="0.3" fill="transparent">
                    <MuscleModelPaths getPathStyle={getPathStyle} />
                </g>
            </svg>
        </div>
    );
}
