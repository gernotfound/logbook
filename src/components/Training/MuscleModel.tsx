
import MuscleModelPaths from './MuscleModelPaths';
import { Logic } from '../../lib/logic';

export default function MuscleModel({ selectedMuscles = [] }: { selectedMuscles?: string[] }) {
    // Determine which svg path IDs should be highlighted based on selectedMuscles
    const activeSvgIds = new Set();
    selectedMuscles.forEach(muscle => {
        // Find exact match in Logic.GROUP_MAP or just use the muscle ID directly
        const mapped = (Logic.GROUP_MAP as any)[muscle];
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
