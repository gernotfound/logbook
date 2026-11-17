import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CycleCard } from '../../../src/components/Training/planning/CycleCard';
import { CycleStrategySummary } from '../../../src/components/Training/planning/CycleStrategySummary';
import { TrainingCycleSchema } from '../../../src/lib/schema';

describe('CycleStrategySummary presentation', () => {
    it('keeps the unspecified label when there is no strategy', () => {
        render(<CycleStrategySummary />);
        expect(screen.getByTestId('cycle-strategy-unspecified').textContent).toBe('Obiettivo non specificato');
    });

    it('lists each muscle only once in its original order while retaining validated source data', () => {
        const cycle = TrainingCycleSchema.parse({
            id: 'cycle-with-repeats',
            name: 'Ciclo importato',
            durationWeeks: 4,
            routines: [],
            strategy: {
                primaryMuscles: ['quads', 'triceps', 'quads'],
                secondaryMuscles: ['lats', 'lats', 'hamstrings'],
            },
        });
        expect(cycle.strategy?.primaryMuscles).toEqual(['quads', 'triceps', 'quads']);
        expect(cycle.strategy?.secondaryMuscles).toEqual(['lats', 'lats', 'hamstrings']);

        render(<CycleStrategySummary strategy={cycle.strategy} />);
        const summary = screen.getByTestId('cycle-strategy-summary');
        expect(summary.textContent).toContain('Obiettivo non specificato');
        expect(screen.getByText('Primario:').parentElement?.textContent).toBe('Primario: Quadricipiti, Tricipiti');
        expect(screen.getByText('Secondario:').parentElement?.textContent).toBe('Secondario: Gran dorsale, Femorali');
        expect(cycle.strategy?.primaryMuscles).toEqual(['quads', 'triceps', 'quads']);
    });

    it('renders the same readable priorities through the expanded real cycle card', () => {
        const cycle = TrainingCycleSchema.parse({
            id: 'cycle-card-strategy',
            name: 'Ciclo con duplicati',
            durationWeeks: 4,
            routines: [],
            strategy: {
                intent: 'development',
                progressionFocus: 'volume',
                primaryMuscles: ['quads', 'quads'],
                secondaryMuscles: ['triceps', 'triceps'],
            },
        });
        render(
            <CycleCard cycle={cycle} routines={[]} isActive={false}
                onSetActive={vi.fn()} onDeactivate={vi.fn()} onEdit={vi.fn()}
                onDuplicate={vi.fn()} onDelete={vi.fn()} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Ciclo con duplicati/ }));
        const summary = screen.getByTestId('cycle-strategy-summary');
        expect(summary.textContent).toContain('Sviluppo · Focus volume');
        expect(screen.getByText('Primario:').parentElement?.textContent).toBe('Primario: Quadricipiti');
        expect(screen.getByText('Secondario:').parentElement?.textContent).toBe('Secondario: Tricipiti');
    });

    it('does not conceal an accepted unknown muscle identifier', () => {
        const cycle = TrainingCycleSchema.parse({
            id: 'cycle-future-muscle',
            name: 'Ciclo',
            durationWeeks: 4,
            routines: [],
            strategy: { intent: 'maintenance', primaryMuscles: ['future_muscle', 'future_muscle'] },
        });
        render(<CycleStrategySummary strategy={cycle.strategy} />);
        expect(screen.getByText('Primario:').parentElement?.textContent).toBe('Primario: future_muscle');
        expect(screen.getByText('Mantenimento')).toBeDefined();
    });
});
