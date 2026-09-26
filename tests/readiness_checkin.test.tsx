import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkoutSessionSchema } from '../src/lib/schema';
import { Exporter } from '../src/lib/export';
import { createBackup, decodeImport, prepareImport } from '../src/lib/backup';
import { UserDataSchema } from '../src/lib/schema';
import { useAppStore } from '../src/store/useAppStore';
import PreSessionCheckIn from '../src/components/Training/PreSessionCheckIn';
import TrainingSession from '../src/components/Training/TrainingSession';
import type { UserData, WorkoutSession } from '../src/types';

vi.mock('../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));

const parseUserData = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

function session(readiness?: WorkoutSession['readiness']): WorkoutSession {
    return {
        id: 'w-readiness',
        date: '2026-09-24',
        routineName: 'Push',
        globalStartTime: 1_700_000_000_000,
        exercises: [{ exId: 'bench', name: 'Panca', sets: [{ id: 's1', kg: '100', reps: '8' }] }],
        ...(readiness ? { readiness } : {}),
    };
}

describe('pre-session readiness contract', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.setState({
            userData: parseUserData({
                nutrition: { '2026-09-24': { date: '2026-09-24', sleepHours: '06:18' } },
                activePains: ['shoulders', 'elbow'],
            }),
            localWorkout: null,
        });
    });

    it('accepts complete and partial readiness while keeping missing values absent, not zero', () => {
        const complete = WorkoutSessionSchema.parse(session({ capturedAt: 123, energy: 1, stress: 2, motivation: 3, muscleRecovery: 5 }));
        expect(complete.readiness).toEqual({ capturedAt: 123, energy: 1, stress: 2, motivation: 3, muscleRecovery: 5 });

        const partial = WorkoutSessionSchema.parse(session({ capturedAt: 456, energy: 4 }));
        expect(partial.readiness).toEqual({ capturedAt: 456, energy: 4 });
        expect(partial.readiness).not.toHaveProperty('stress');
        expect(partial.readiness?.stress).not.toBe(0);

        const skipped = WorkoutSessionSchema.parse(session());
        expect(skipped.readiness).toBeUndefined();
    });

    it.each([0, 6, -1, 2.5])('drops readiness values outside the integer 1-5 contract instead of persisting them: %s', value => {
        const parsed = WorkoutSessionSchema.parse(session({ capturedAt: 123, energy: value }));
        expect(parsed.readiness).toBeUndefined();
    });

    it('renders large 1-5 controls, canonical sleep and active pains without starting automatically', async () => {
        const onStart = vi.fn(async () => true);
        render(<PreSessionCheckIn routineName="Push" date="2026-09-24" onStart={onStart} onCancel={vi.fn(async () => {})} />);

        expect(screen.getByText('Registrato: 6 h 18 min')).toBeTruthy();
        expect(screen.getByText(/Spalle/)).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /su 5/ })).toHaveLength(20);
        expect(onStart).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        fireEvent.click(screen.getByRole('button', { name: 'Stress: 2 su 5' }));
        fireEvent.click(screen.getByRole('button', { name: 'Inizia allenamento' }));
        await waitFor(() => expect(onStart).toHaveBeenCalledWith({ energy: 4, stress: 2 }));
    });

    it('keeps a prepared workout in check-in state until the explicit start command', () => {
        useAppStore.setState({
            localWorkout: { id: 'pending', date: '2026-09-24', routineName: 'Push', exercises: [] },
        });
        render(<TrainingSession />);
        expect(screen.getByRole('heading', { name: 'Come arrivi oggi?' })).toBeTruthy();
        expect(screen.queryByText('Durata Totale')).toBeNull();
    });

    it('scrolls to the top after confirming the pre-session check-in', async () => {
        const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        useAppStore.setState({
            localWorkout: { id: 'pending-scroll', date: '2026-09-24', routineName: 'Push', exercises: [] },
        });

        render(<TrainingSession />);
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        fireEvent.click(screen.getByRole('button', { name: 'Inizia allenamento' }));

        await waitFor(() => expect(useAppStore.getState().localWorkout?.globalStartTime).toBeTruthy());
        expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
        scrollToSpy.mockRestore();
    });

    it('anchors the workout date to the actual local start time when check-in crosses midnight', async () => {
        const startedAt = new Date(2026, 8, 25, 0, 0, 5).getTime();
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
        useAppStore.setState({
            localWorkout: { id: 'pending-midnight', date: '2026-09-24', routineName: 'Push', ratingScale: 5, exercises: [] },
        });
        render(<TrainingSession />);
        fireEvent.click(screen.getByRole('button', { name: 'Salta check-in e inizia' }));
        await waitFor(() => {
            const started = useAppStore.getState().localWorkout;
            expect(started?.globalStartTime).toBe(startedAt);
            expect(started?.date).toBe('2026-09-25');
        });
        nowSpy.mockRestore();
    });

    it('skips the check-in without inventing values', async () => {
        const onStart = vi.fn(async () => true);
        render(<PreSessionCheckIn date="2026-09-24" onStart={onStart} onCancel={vi.fn(async () => {})} />);
        fireEvent.click(screen.getByRole('button', { name: 'Salta check-in e inizia' }));
        await waitFor(() => expect(onStart).toHaveBeenCalledWith(undefined));
    });

    it('round-trips readiness through backup/restore without a schema migration', () => {
        const data = parseUserData({ history: [session({ capturedAt: 123, energy: 5, muscleRecovery: 3 })] });
        const backup = JSON.parse(JSON.stringify(createBackup(data, 'guest')));
        const restored = prepareImport(parseUserData({}), decodeImport(backup, 'guest').data, 'restore').data;
        expect(restored.history?.[0].readiness).toEqual({ capturedAt: 123, energy: 5, muscleRecovery: 3 });
    });

    it('exports the four readiness dimensions and leaves absent dimensions empty', async () => {
        let content = '';
        vi.spyOn(Exporter, 'downloadFile').mockImplementation((filename, value) => {
            if (filename === 'allenamenti.csv') content = value;
        });
        await Exporter.exportToCSV([session({ capturedAt: 123, energy: 5, stress: 1, muscleRecovery: 3 })], {}, []);
        expect(content.split('\n')[0]).toContain('Energia pre-sessione,Stress pre-sessione,Motivazione pre-sessione,Recupero muscolare pre-sessione');
        const columns = content.split('\n')[1].split(',');
        expect(columns.slice(-4)).toEqual(['5', '1', '""', '3']);
        vi.restoreAllMocks();
    });
});
