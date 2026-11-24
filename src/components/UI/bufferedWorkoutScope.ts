import { createContext } from 'react';

/** Explicit workout identity for device recovery, including history editing. */
export const BufferedWorkoutScope = createContext<string | null>(null);

/** The account editor proves a session before touching its already durable local draft. */
export const DurableWorkoutEditScope = createContext<null | (() => (() => boolean) | null)>(null);
