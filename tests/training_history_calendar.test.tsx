import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import TrainingHistory from '../src/components/Training/TrainingHistory';
import { createMockUserData, renderWithProviders } from './setup';
import type { WorkoutSession } from '../src/types';

const septemberEvening = new Date(2026, 8, 28, 18, 0, 0, 0).getTime();
const septemberMorning = new Date(2026, 8, 28, 8, 30, 0, 0).getTime();

const history: WorkoutSession[] = [
  {
    id: 'w-sep-a',
    date: '2026-09-28',
    routineName: 'Scheda con un nome volutamente molto lungo per il calendario',
    globalStartTime: septemberEvening,
    globalEndTime: septemberEvening + 70 * 60 * 1000,
    exercises: [
      { exId: 'ex1', sets: [{ id: 's1', kg: '80', reps: '10' }] },
      { exId: 'ex2', sets: [{ id: 's2', kg: '100', reps: '5' }] },
    ],
  },
  {
    id: 'w-sep-b',
    date: '2026-09-28',
    routineName: 'Seconda sessione',
    globalStartTime: septemberMorning,
    manualDurationStr: '35 min',
    exercises: [
      { exId: 'ex1', sets: [{ id: 's3', kg: '70', reps: '12' }] },
    ],
  },
  {
    id: 'w-aug',
    date: '2026-08-15',
    routineName: 'Sessione di agosto',
    globalDurationStr: '01:00:00',
    exercises: [
      { exId: 'ex1', sets: [{ id: 's4', kg: '75', reps: '10' }] },
    ],
  },
];

function renderHistory() {
  return renderWithProviders(<TrainingHistory />, {
    userData: createMockUserData({ history }),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TrainingHistory calendar', () => {
  it('shows the monthly calendar, monthly summary and multiple sessions on one day', () => {
    const { container } = renderHistory();

    expect(screen.getByText('Settembre 2026')).toBeDefined();

    const day = screen.getByRole('button', {
      name: /Lunedì 28 settembre 2026, 2 allenamenti/i,
    });
    expect(day.querySelector('.history-day-count')?.textContent).toBe('2');

    const summary = screen.getByRole('region', { name: 'Riepilogo del mese' });
    expect(within(summary).getByText('2')).toBeDefined();
    expect(within(summary).getByText('1 h 45 min')).toBeDefined();

    expect(screen.getByText('Scheda con un nome volutamente molto lungo per il calendario')).toBeDefined();
    expect(screen.getByText('Seconda sessione')).toBeDefined();
    expect(container.querySelector('input[type="month"]')).toBeNull();
    expect(screen.queryByText(/Vai all'allenamento precedente/i)).toBeNull();
    expect(screen.queryByText(/Vai direttamente al mese/i)).toBeNull();
  });

  it('navigates months and uses the internal month/year picker', () => {
    renderHistory();

    fireEvent.click(screen.getByRole('button', { name: 'Mese precedente' }));
    expect(screen.getByText('Agosto 2026')).toBeDefined();
    expect(screen.getByText('Sessione di agosto')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Mese e anno/i }));
    const picker = screen.getByRole('region', { name: 'Scegli mese e anno' });
    expect(within(picker).getByRole('button', { name: /Ago 2026, contiene allenamenti/i })).toBeDefined();

    fireEvent.click(within(picker).getByRole('button', { name: 'Anno precedente' }));
    const previousYearPicker = screen.getByRole('region', { name: 'Scegli mese e anno' });
    expect(within(previousYearPicker).getByRole('button', { name: 'Ago 2025' })).toBeDefined();

    fireEvent.click(within(previousYearPicker).getByRole('button', { name: 'Anno successivo' }));
    const restoredPicker = screen.getByRole('region', { name: 'Scegli mese e anno' });
    fireEvent.click(within(restoredPicker).getByRole('button', { name: /Set 2026, contiene allenamenti/i }));

    expect(screen.getByText('Settembre 2026')).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Scegli mese e anno' })).toBeNull();
  });

  it('returns to the real current local date and opens the existing workout detail', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 12, 0, 0, 0));

    renderHistory();

    fireEvent.click(screen.getByRole('button', { name: 'Mese precedente' }));
    expect(screen.getByText('Agosto 2026')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Oggi' }));
    expect(screen.getByText('Settembre 2026')).toBeDefined();
    expect(screen.getByRole('button', {
      name: /Lunedì 28 settembre 2026, 2 allenamenti/i,
    }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', {
      name: /Apri il dettaglio di Scheda con un nome volutamente molto lungo/i,
    }));

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Allenamento completato')).toBeDefined();
  });
});
