import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataMeasurements from '../../../src/components/Data/DataMeasurements';

function props(choice: boolean, onChoice: (choice: boolean) => void, onSave: ReturnType<typeof vi.fn>) {
    const noop = vi.fn();
    return {
        profile: { gender: 'M' as const, height: 177 },
        targetDateStr: '2026-11-20', hasExistingData: true,
        measureTime: '08:00', setMeasureTime: noop,
        weight: '81', setWeight: noop,
        waist: '89', setWaist: noop,
        neck: '40', setNeck: noop,
        hip: '', setHip: noop,
        chest: '', setChest: noop,
        shoulders: '', setShoulders: noop,
        biceps: '', setBiceps: noop,
        thighs: '', setThighs: noop,
        calves: '', setCalves: noop,
        handleCancelEdit: noop,
        calculateBfChoice: choice,
        onCalculateBfChoiceChange: onChoice,
        calculateAndSave: onSave,
    };
}

describe('Kinde measurement BF draft choice', () => {
    it('uses a persisted controlled opt-in rather than local-only checkbox state', () => {
        const onChoice = vi.fn();
        const onSave = vi.fn().mockResolvedValue(true);
        const { rerender } = render(<DataMeasurements {...props(false, onChoice, onSave)} />);
        const checkbox = screen.getByRole('checkbox', { name: /Calcola la massa grassa/i }) as HTMLInputElement;
        expect(checkbox.checked).toBe(false);
        fireEvent.click(checkbox);
        expect(onChoice).toHaveBeenCalledExactlyOnceWith(true);
        expect(checkbox.checked).toBe(false);
        rerender(<DataMeasurements {...props(true, onChoice, onSave)} />);
        expect(checkbox.checked).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Salva modifiche' }));
        expect(onSave).toHaveBeenCalledWith(expect.anything(), true);
        rerender(<DataMeasurements {...props(false, onChoice, onSave)} />);
        expect(checkbox.checked).toBe(false);
    });
});
