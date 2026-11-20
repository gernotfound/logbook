import React from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BufferedWorkoutScope } from '../../../src/components/UI/bufferedWorkoutScope';
import type { WorkoutSession } from '../../../src/types';
import { captureSession } from '../../../src/lib/sync/session';
import { useAppStore } from '../../../src/store/useAppStore';
import { localStorageMock } from '../../setup';
import { field, initialGetItem, initialSetItem } from './bufferedRecoveryFixtures';

export function setupBufferedWriterEvidence(kind: 'input' | 'textarea') {
    const workoutId = 'same-workout';
    const draftName = `draft:buffered:${kind}:${workoutId}:stable-draft`;
    const mount = (update: (value: string) => void, value = '') => render(
        <BufferedWorkoutScope.Provider value={workoutId}>
            {field(kind, update, value)}
        </BufferedWorkoutScope.Provider>
    );
    const edited = (view: ReturnType<typeof render>) =>
        view.container.querySelector(kind === 'input' ? 'input' : 'textarea') as HTMLInputElement | HTMLTextAreaElement;

    beforeEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        localStorage.clear();
        useAppStore.setState({
            localWorkout: { id: workoutId } as WorkoutSession,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', saveError: null,
        });
        const owner = captureSession().owner;
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    });
    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        vi.restoreAllMocks();
    });
    return { workoutId, draftName, mount, edited };
}
