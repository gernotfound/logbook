import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import TrainingHistory from '../../../src/components/Training/TrainingHistory';
import { useAppStore } from '../../../src/store/useAppStore';
import { createMockUserData, renderWithProviders } from '../../setup';
import { Logic } from '../../../src/lib/logic';
import type { WorkoutSession } from '../../../src/types';

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
      { exId: 'ex1', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '10' }] },
      { exId: 'ex2', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '5' }] },
    ],
  },
  {
    id: 'w-sep-b',
    date: '2026-09-28',
    routineName: 'Seconda sessione',
    globalStartTime: septemberMorning,
    manualDurationStr: '35 min',
    exercises: [
      { exId: 'ex1', sessionNote: '', sets: [{ id: 's3', kg: '70', reps: '12' }] },
    ],
  },
  {
    id: 'w-aug',
    date: '2026-08-15',
    routineName: 'Sessione di agosto',
    globalDurationStr: '01:00:00',
    exercises: [
      { exId: 'ex1', sessionNote: '', sets: [{ id: 's4', kg: '75', reps: '10' }] },
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
  vi.restoreAllMocks();
});

describe('TrainingHistory calendar', () => {
  it('validates each workout date once while indexing a large unsorted history', () => {
    const workouts: WorkoutSession[] = Array.from({ length: 120 }, (_, index) => ({
      id: `session-${index}`,
      date: index === 119 ? '2026-09-28' : index % 2 === 0 ? '2026-08-15' : '2026-07-12',
      routineName: index === 119 ? 'Sessione più recente' : `Sessione ${index}`,
      exercises: [],
    }));
    const dateParser = vi.spyOn(Logic, 'parseDateInput');
    renderWithProviders(<TrainingHistory />, {
      userData: createMockUserData({ history: workouts }),
    });

    expect(screen.getByText('Settembre 2026')).toBeDefined();
    expect(screen.getByText('Sessione più recente')).toBeDefined();
    expect(screen.getByRole('button', { name: /Lunedì 28 settembre 2026, 1 allenamento/i })).toBeDefined();
    // Initial date, presence and calendar indexing reuse the validated list.
    expect(dateParser).toHaveBeenCalledTimes(workouts.length);

    fireEvent.click(screen.getByRole('button', { name: 'Mese precedente' }));
    expect(screen.getByText('Agosto 2026')).toBeDefined();
    expect(screen.getByRole('button', { name: /Sabato 15 agosto 2026, 60 allenamenti/i })).toBeDefined();
    expect(dateParser).toHaveBeenCalledTimes(workouts.length);
  });

  it('ignores pre-launch stored date aliases while retaining the current start timestamp fallback', () => {
    const mixed: WorkoutSession[] = [
      history[0],
      { ...history[1], id: 'timestamp-current', date: '20/12/2026', routineName: 'Timestamp corrente' },
      { id: 'alias-only', date: '2026-12-1', routineName: 'Solo alias pre-lancio', exercises: [] },
    ];
    const before = structuredClone(mixed);
    renderWithProviders(<TrainingHistory />, { userData: createMockUserData({ history: mixed }) });
    expect(screen.getByText('Settembre 2026')).toBeDefined();
    expect(screen.getByRole('button', { name: /Lunedì 28 settembre 2026, 2 allenamenti/i })).toBeDefined();
    expect(screen.getByText('Timestamp corrente')).toBeDefined();
    expect(screen.queryByText('Solo alias pre-lancio')).toBeNull();
    expect(mixed).toEqual(before);
  });

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


  it('uses manually corrected duration in monthly totals and workout rows, consistently with the report', () => {
    const corrected: WorkoutSession[] = [
      { ...history[0], manualDurationStr: '00:35:00', globalDurationStr: '01:10:00' },
      history[1],
      history[2],
    ];
    renderWithProviders(<TrainingHistory />, {
      userData: createMockUserData({ history: corrected }),
    });

    const summary = screen.getByRole('region', { name: 'Riepilogo del mese' });
    expect(within(summary).getByText('1 h 10 min')).toBeDefined();

    const open = screen.getByRole('button', { name: /Apri il dettaglio di Scheda con un nome volutamente molto lungo/i });
    expect(open.textContent).toContain('35 min');
    fireEvent.click(open);
    expect(within(screen.getByRole('dialog')).getByText('00:35:00')).toBeDefined();
  });

  it('updates an open report from the current history and closes it when the workout disappears', () => {
    const initial = createMockUserData({ history });
    renderWithProviders(<TrainingHistory />, { userData: initial });
    fireEvent.click(screen.getByRole('button', { name: 'Apri il dettaglio di Seconda sessione' }));
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Seconda sessione' })).toBeDefined();

    const updated = history.map(workout => workout.id === 'w-sep-b'
      ? { ...workout, routineName: 'Seconda sessione aggiornata', manualDurationStr: '00:20:00' }
      : workout);
    act(() => {
      useAppStore.setState({ userData: { ...initial, history: updated } });
    });
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Seconda sessione aggiornata' })).toBeDefined();
    expect(within(screen.getByRole('dialog')).getByText('00:20:00')).toBeDefined();

    act(() => {
      useAppStore.setState({ userData: { ...initial, history: updated.filter(workout => workout.id !== 'w-sep-b') } });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not interpret out-of-range timestamps as a date or crash while formatting a saved day', () => {
    const corruptedTime: WorkoutSession[] = [
      { id: 'valid-date', date: '2026-09-28', routineName: 'Data valida con orario invalido',
        globalStartTime: Number.MAX_VALUE, exercises: [] },
      { id: 'no-date', routineName: 'Senza data rappresentabile',
        globalStartTime: Number.MAX_VALUE, exercises: [] },
    ];
    renderWithProviders(<TrainingHistory />, {
      userData: createMockUserData({ history: corruptedTime }),
    });
    expect(screen.getByText('Data valida con orario invalido')).toBeDefined();
    const open = screen.getByRole('button', { name: 'Apri il dettaglio di Data valida con orario invalido' });
    expect(open.textContent).toContain('Orario n.d.');
    expect(screen.queryByText('Senza data rappresentabile')).toBeNull();
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
