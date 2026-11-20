import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkoutReportContent } from '../../../src/components/Training/report/WorkoutReportContent';
import type { WorkoutReport } from '../../../src/lib/calc/workoutReport';
import type { WorkoutSession } from '../../../src/types';

const workout: WorkoutSession = {
    id: 'report-content',
    exercises: [],
    readiness: { capturedAt: 1000, energy: 4 },
    moodRating: 3,
    waterLiters: 1.5,
};

const baseReport: WorkoutReport = {
    workoutId: 'report-content',
    workoutName: 'Sessione',
    date: '2026-11-20',
    durationSeconds: 120,
    isFirstSession: false,
    totalVolume: 12,
    totalVolumeIsComplete: true,
    exerciseComparisons: [],
    newPRs: [],
};

describe('workout report presentation', () => {
    it('keeps before, progression and after sections accessible with canonical weight formatting', () => {
        const { rerender } = render(<WorkoutReportContent workout={workout} report={baseReport} titleId="report" />);

        const before = screen.getByRole('region', { name: 'Prima della sessione' });
        expect(within(before).getByText('4/5')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Progressione contestuale' })).toBeTruthy();
        expect(screen.getByText('12 kg')).toBeTruthy();
        const after = screen.getByRole('region', { name: 'Dopo la sessione' });
        expect(within(after).getByText('3/5')).toBeTruthy();
        expect(within(after).getByText('1.5 L')).toBeTruthy();

        rerender(<WorkoutReportContent workout={workout} report={{ ...baseReport, totalVolume: 1000 }} titleId="report" />);
        expect(screen.getByText('1.00 t')).toBeTruthy();
    });

    it('does not present incomplete tonnage as confirmed and preserves the baseline explanation', () => {
        render(<WorkoutReportContent
            workout={{ ...workout, readiness: undefined, moodRating: undefined, waterLiters: undefined }}
            report={{ ...baseReport, totalVolume: 20, totalVolumeIsComplete: false, isFirstSession: true }}
            titleId="report"
        />);

        expect(screen.getByText('Dati incompleti')).toBeTruthy();
        expect(screen.queryByText('20 kg')).toBeNull();
        expect(screen.getByText('Nuova baseline registrata')).toBeTruthy();
        expect(screen.queryByRole('region', { name: 'Prima della sessione' })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Dopo la sessione' })).toBeNull();
    });
    it('hides an empty after-session section for null ratings and shows recorded muscle pain names', () => {
        const ratingsOnlyNull: WorkoutSession = {
            ...workout,
            readiness: undefined,
            moodRating: null,
            pumpRating: null,
            fatigueRating: null,
            waterLiters: undefined,
            pains: [],
        };
        const { rerender } = render(<WorkoutReportContent workout={ratingsOnlyNull} report={baseReport} titleId="report" />);
        expect(screen.queryByRole('region', { name: 'Dopo la sessione' })).toBeNull();

        rerender(<WorkoutReportContent
            workout={{ ...ratingsOnlyNull, pains: ['chest', 'quads_right'] }}
            report={baseReport}
            titleId="report"
        />);
        const after = screen.getByRole('region', { name: 'Dopo la sessione' });
        expect(within(after).getByText('Petto, Quadricipite destro')).toBeTruthy();
    });

});
