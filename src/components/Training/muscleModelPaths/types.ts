import type { CSSProperties } from 'react';

export interface MuscleModelPathProps {
    getPathId: (pathId: string) => string;
    getPathStyle: (pathId: string) => CSSProperties;
}
