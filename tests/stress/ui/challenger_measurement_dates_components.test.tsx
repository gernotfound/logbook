import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { getLocalDateString, formatItalianDate, parseDateInput } from '../../../src/lib/utils/date';
import DataMeasurements from '../../../src/components/Data/DataMeasurements';
import { useAppStore } from '../../../src/store/useAppStore';

describe('Measurement date UI boundary stress', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

    describe('R3: Measurements Date Selector & Date Utilities Robustness', () => {

        it('getLocalDateString returns YYYY-MM-DD in local time and prevents UTC drift', () => {
            const d = new Date(2026, 7, 20, 0, 30, 0); // August 20, 2026, 00:30 local time
            const localStr = getLocalDateString(d);
            expect(localStr).toBe('2026-08-20');
        });

        it('formatItalianDate correctly formats leap years, month boundaries, and future dates', () => {
            expect(formatItalianDate('2024-02-29')).toContain('2024');
            expect(formatItalianDate('2026-12-31')).toContain('2026');
            expect(formatItalianDate('2027-01-01')).toContain('2027');
            expect(formatItalianDate('invalid-date')).toBe('');
        });

        it('parseDateInput parses Italian date strings and ISO strings robustly', () => {
            const isoParsed = parseDateInput('2026-08-20');
            expect(isoParsed).toBe('2026-08-20');

            const itParsed = parseDateInput('20/08/2026');
            expect(itParsed).toBe('2026-08-20');

            const invalidParsed = parseDateInput('invalid-date');
            expect(invalidParsed).toBeNull();
        });

        it('DataMeasurements renders date selector and measurement inputs at top', () => {
            render(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    editingDate={null}
                    measureTime="08:00"
                    setMeasureTime={vi.fn()}
                    weight="77.5"
                    setWeight={vi.fn()}
                    waist="80"
                    setWaist={vi.fn()}
                    neck="38"
                    setNeck={vi.fn()}
                    hip=""
                    setHip={vi.fn()}
                    chest=""
                    setChest={vi.fn()}
                    shoulders=""
                    setShoulders={vi.fn()}
                    biceps=""
                    setBiceps={vi.fn()}
                    thighs=""
                    setThighs={vi.fn()}
                    calves=""
                    setCalves={vi.fn()}
                    handleCancelEdit={vi.fn()}
                    calculateAndSave={vi.fn()}
                />
            );

            expect(screen.getByText(/Nuova misurazione/)).toBeDefined();
            expect(screen.getByDisplayValue('77.5')).toBeDefined();
            expect(screen.getByDisplayValue('80')).toBeDefined();
        });
    });
});
