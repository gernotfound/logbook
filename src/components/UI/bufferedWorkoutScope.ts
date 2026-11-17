import { createContext } from 'react';

/** Explicit workout identity for device recovery, including history editing. */
export const BufferedWorkoutScope = createContext<string | null>(null);
