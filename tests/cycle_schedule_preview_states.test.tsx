import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { calculateCycleSchedule } from '../src/lib/calc/planning';
import { CycleSchedulePreview } from '../src/components/Training/planning/CycleSchedulePreview';
import { CycleCard } from '../src/components/Training/planning/CycleCard';
import type { TrainingCycle, WorkoutRoutine } from '../src/types';

const routines: WorkoutRoutine[] = [
    { id: 'upper', name: 'Upper body', exercises: [] },
    { id: 'lower', name: 'Lower body', exercises: [] },
];

const cycle: TrainingCycle = {
    id: 'preview-cycle',
    name: 'Ciclo anteprima',
    durationWeeks: 2,
    sessionsPerWeek: 2,
    routines: [
        { routineId: 'upper', frequencyPerWeek: 1 },
        { routineId: 'lower', frequencyPerWeek: 1 },
    ],
};

describe('CycleSchedulePreview: states and accessibility', () => {
    it('links the expanded trigger and region without building hidden week details', () => {
        const closedSchedule = calculateCycleSchedule(cycle, routines, false);
        expect(closedSchedule.totalSessions).toBe(4);
        expect(closedSchedule.weeks).toEqual([]);
        const onTogglePreview = vi.fn();
        const { rerender } = render(
            <CycleSchedulePreview schedule={closedSchedule} showPreview={false} onTogglePreview={onTogglePreview} />,
        );

        const toggle = screen.getByRole('button', { name: /Anteprima della rotazione flessibile.*chiusa/i });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.hasAttribute('aria-controls')).toBe(false);
        expect(screen.queryByRole('region')).toBeNull();
        expect(screen.queryByText('Settimana 1')).toBeNull();
        fireEvent.click(toggle);
        expect(onTogglePreview).toHaveBeenCalledOnce();

        rerender(
            <CycleSchedulePreview
                schedule={calculateCycleSchedule(cycle, routines)}
                showPreview
                onTogglePreview={onTogglePreview}
            />,
        );

        const expanded = screen.getByRole('button', { name: /Anteprima della rotazione flessibile.*aperta/i });
        const region = screen.getByRole('region', { name: /Anteprima della rotazione flessibile/i });
        expect(expanded.getAttribute('aria-expanded')).toBe('true');
        expect(expanded.getAttribute('aria-controls')).toBe(region.id);
        expect(region.getAttribute('aria-labelledby')).toBe(expanded.id);
        expect(within(region).getByText('Settimana 1')).toBeDefined();
        expect(within(region).getByText('Settimana 2')).toBeDefined();
        expect(region.querySelector('.planning-schedule-sessions span')?.textContent).toBe('#1 Upper body');
        expect(within(region).getByText(/Anteprima indicativa:/)).toBeDefined();

        rerender(
            <CycleSchedulePreview schedule={closedSchedule} showPreview={false} onTogglePreview={onTogglePreview} />,
        );
        expect(screen.queryByRole('region')).toBeNull();
        expect(screen.queryByText('Settimana 1')).toBeNull();
    });

    it('does not show flexible-session guidance when the schedule calculation rejects invalid input', () => {
        const invalid = calculateCycleSchedule({ ...cycle, durationWeeks: -2 }, routines);
        expect(invalid.summaryText).toBe('Parametri del ciclo da correggere');
        expect(invalid.weeks).toEqual([]);
        render(<CycleSchedulePreview schedule={invalid} showPreview onTogglePreview={vi.fn()} />);
        const region = screen.getByRole('region', { name: /Anteprima della rotazione flessibile/i });

        expect(within(region).getByRole('status').textContent)
            .toBe('Correggi i parametri del ciclo per visualizzare la rotazione.');
        expect(within(region).queryByText(/Anteprima indicativa:/)).toBeNull();
        expect(within(region).queryByText('Settimana 1')).toBeNull();
        expect(screen.getByRole('button', { name: /parametri da correggere.*aperta/i })).toBeDefined();
    });

    it('distinguishes no planned sessions from a deferred weekly detail', () => {
        const empty = calculateCycleSchedule(null, routines);
        const onTogglePreview = vi.fn();
        const { rerender } = render(
            <CycleSchedulePreview schedule={empty} showPreview onTogglePreview={onTogglePreview} />,
        );
        let region = screen.getByRole('region', { name: /Anteprima della rotazione flessibile/i });
        expect(within(region).getByRole('status').textContent).toBe('Nessuna seduta da visualizzare.');

        const deferred = calculateCycleSchedule(cycle, routines, false);
        rerender(<CycleSchedulePreview schedule={deferred} showPreview onTogglePreview={onTogglePreview} />);
        region = screen.getByRole('region', { name: /Anteprima della rotazione flessibile/i });
        expect(within(region).getByRole('status').textContent)
            .toBe('Il dettaglio della rotazione non è disponibile.');
        expect(within(region).queryByText(/Anteprima indicativa:/)).toBeNull();
    });

    it('surfaces the same honest invalid state through a saved cycle card', () => {
        const onAction = vi.fn();
        render(
            <CycleCard
                cycle={{ ...cycle, durationWeeks: -2 }}
                isActive={false}
                routines={routines}
                onSetActive={onAction}
                onDeactivate={onAction}
                onEdit={onAction}
                onDuplicate={onAction}
                onDelete={onAction}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Ciclo anteprima/ }));
        fireEvent.click(screen.getByRole('button', { name: /Anteprima della rotazione flessibile.*chiusa/i }));

        const region = screen.getByRole('region', { name: /Anteprima della rotazione flessibile/i });
        expect(within(region).getByRole('status').textContent)
            .toContain('Correggi i parametri del ciclo');
        expect(within(region).queryByText(/Anteprima indicativa:/)).toBeNull();
        expect(onAction).not.toHaveBeenCalled();
    });
});
