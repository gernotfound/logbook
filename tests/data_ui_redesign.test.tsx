import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataHistory from '../src/components/Data/DataHistory';
import DataMeasurements from '../src/components/Data/DataMeasurements';

function measurementProps(overrides: Record<string, unknown> = {}) {
    return {
        profile: { gender: 'M', height: 180 },
        selectedDate: '2026-10-05',
        setSelectedDate: vi.fn(),
        targetDateStr: '2026-10-05',
        editingDate: null,
        hasExistingData: false,
        measureTime: '07:30',
        setMeasureTime: vi.fn(),
        weight: '81.6',
        setWeight: vi.fn(),
        waist: '84.5',
        setWaist: vi.fn(),
        neck: '38',
        setNeck: vi.fn(),
        hip: '',
        setHip: vi.fn(),
        manualBf: '16.8',
        setManualBf: vi.fn(),
        chest: '101',
        setChest: vi.fn(),
        shoulders: '118',
        setShoulders: vi.fn(),
        biceps: '37.5',
        setBiceps: vi.fn(),
        thighs: '59',
        setThighs: vi.fn(),
        calves: '38.5',
        setCalves: vi.fn(),
        handleCancelEdit: vi.fn(),
        calculateAndSave: vi.fn().mockResolvedValue(true),
        onOpenBiometry: vi.fn(),
        ...overrides,
    };
}

describe('Data UI redesign', () => {
    it('switches body-fat modes without losing draft values or duplicating Navy fields', () => {
        const props = measurementProps();
        const { container } = render(<DataMeasurements {...props} />);

        const manual = screen.getByRole('radio', { name: /BF manuale/i }) as HTMLInputElement;
        const calculate = screen.getByRole('radio', { name: /Calcolo da misure/i }) as HTMLInputElement;

        expect(manual.checked).toBe(true);
        expect((container.querySelector('#measure-bf') as HTMLInputElement).value).toBe('16.8');
        expect(container.querySelectorAll('#measure-waist')).toHaveLength(1);
        expect(container.querySelectorAll('#measure-neck')).toHaveLength(1);

        fireEvent.click(calculate);

        expect(calculate.checked).toBe(true);
        expect(container.querySelector('#measure-bf')).toBeNull();
        expect(container.querySelectorAll('#measure-waist')).toHaveLength(1);
        expect(container.querySelectorAll('#measure-neck')).toHaveLength(1);
        expect((container.querySelector('#measure-waist') as HTMLInputElement).value).toBe('84.5');
        expect((container.querySelector('#measure-neck') as HTMLInputElement).value).toBe('38');
        expect(screen.getAllByText(/Metodo US Navy/i).length).toBeGreaterThan(0);

        fireEvent.click(manual);

        expect((container.querySelector('#measure-bf') as HTMLInputElement).value).toBe('16.8');
        expect((container.querySelector('#measure-waist') as HTMLInputElement).value).toBe('84.5');
        expect((container.querySelector('#measure-neck') as HTMLInputElement).value).toBe('38');
    });

    it('submits the explicitly selected body-fat mode to the existing save callback', () => {
        const calculateAndSave = vi.fn().mockResolvedValue(true);
        render(<DataMeasurements {...measurementProps({ calculateAndSave })} />);

        fireEvent.click(screen.getByRole('radio', { name: /Calcolo da misure/i }));
        fireEvent.click(screen.getByRole('button', { name: /Salva misurazione/i }));

        expect(calculateAndSave).toHaveBeenCalledWith(expect.anything(), 'calculate');
    });

    it('renders the Data history calendar, detail view and real contextual callbacks', () => {
        const onSelectEdit = vi.fn();
        const onDeleteMeasurement = vi.fn();
        render(
            <DataHistory
                measurementsHistory={[
                    {
                        date: '2026-10-05',
                        measurementTime: '07:28',
                        weight: 81.4,
                        bf: 16.7,
                        bfProvenance: { method: 'manual' },
                        waist: 84.2,
                        neck: 38,
                        sleepHours: '07:44',
                    },
                ]}
                editingDate={null}
                onSelectEdit={onSelectEdit}
                onDeleteMeasurement={onDeleteMeasurement}
            />
        );

        expect(screen.getByText('Storico Dati')).toBeDefined();
        expect(screen.getByLabelText(/Calendario ottobre 2026/i)).toBeDefined();
        expect(screen.getByText('81,4 kg')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));
        expect(screen.getByRole('dialog')).toBeDefined();
        expect(screen.getAllByText('16,7%').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica misurazione' }));
        expect(onSelectEdit).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina misurazione' }));
        expect(onDeleteMeasurement).toHaveBeenCalledWith('2026-10-05');
    });
});
