import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HomeWorkoutWidget from '../src/components/Home/widgets/HomeWorkoutWidget';
import type { WorkoutSession } from '../src/types';

const completedWorkout = {
  id: 'completed-1',
  routineName: 'Push',
  exercises: [],
} as unknown as WorkoutSession;

const activeWorkout = {
  id: 'active-1',
  routineName: 'Pull',
  exercises: [],
} as unknown as WorkoutSession;

describe('Home workout navigation', () => {
  it('sends a completed workout CTA to training history', () => {
    const onNavigate = vi.fn();
    render(<HomeWorkoutWidget isRestDay={false} todaysWorkout={completedWorkout} activeWorkout={null} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Apri lo storico degli allenamenti/i }));
    expect(onNavigate).toHaveBeenCalledWith('training-history');
  });

  it('keeps an active workout CTA on the session view', () => {
    const onNavigate = vi.fn();
    render(<HomeWorkoutWidget isRestDay todaysWorkout={null} activeWorkout={activeWorkout} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Riprendi allenamento/i }));
    expect(onNavigate).toHaveBeenCalledWith('training');
  });
});
