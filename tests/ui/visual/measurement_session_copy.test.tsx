import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DataMeasurements from '../../../src/components/Data/DataMeasurements';
import { SessionRatings } from '../../../src/components/Training/session/SessionRatings';

function measurementProps(): ComponentProps<typeof DataMeasurements> {
  return {
    profile: { gender: 'M' },
    measureTime: '',
    setMeasureTime: vi.fn(),
    weight: '',
    setWeight: vi.fn(),
    waist: '',
    setWaist: vi.fn(),
    neck: '',
    setNeck: vi.fn(),
    hip: '',
    setHip: vi.fn(),
    chest: '',
    setChest: vi.fn(),
    shoulders: '',
    setShoulders: vi.fn(),
    biceps: '',
    setBiceps: vi.fn(),
    thighs: '',
    setThighs: vi.fn(),
    calves: '',
    setCalves: vi.fn(),
    handleCancelEdit: vi.fn(),
    calculateAndSave: vi.fn(async () => true),
  };
}

describe('Measurement and session UI wording', () => {
  it('exposes optional measurements through a working native disclosure', () => {
    const setChest = vi.fn();
    render(<DataMeasurements {...measurementProps()} setChest={setChest} />);

    const summary = screen.getByText('Altre misurazioni').closest('summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('5 campi opzionali');
    const details = summary?.closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    fireEvent.click(summary!);
    expect(details?.open).toBe(true);
    const chest = details?.querySelector<HTMLInputElement>('#measure-chest');
    expect(chest).not.toBeNull();
    fireEvent.change(chest!, { target: { value: '101.5' } });
    expect(setChest).toHaveBeenCalledWith('101.5');
  });

  it('labels session ratings accessibly and forwards a selected score', () => {
    const setMood = vi.fn();
    const props = {
      water: '',
      setWater: vi.fn(),
      mood: '2',
      setMood,
      pump: '',
      setPump: vi.fn(),
      fatigue: '',
      setFatigue: vi.fn(),
    };
    const { rerender } = render(<SessionRatings {...props} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Valuta sessione' })).toBeDefined();
    const moodGroup = screen.getByRole('group', { name: 'Umore, scala da 1 a 5' });
    expect(screen.getByRole('group', { name: 'Pump, scala da 1 a 5' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Stanchezza, scala da 1 a 5' })).toBeDefined();
    expect(within(moodGroup).getByRole('button', { name: 'Umore: 2 su 5' }).getAttribute('aria-pressed'))
      .toBe('true');

    fireEvent.click(within(moodGroup).getByRole('button', { name: 'Umore: 4 su 5' }));
    expect(setMood).toHaveBeenCalledTimes(1);
    expect(setMood).toHaveBeenCalledWith('4');

    rerender(<SessionRatings {...props} mood="4" />);
    expect(within(moodGroup).getByRole('button', { name: 'Umore: 4 su 5' }).getAttribute('aria-pressed'))
      .toBe('true');
  });
});
