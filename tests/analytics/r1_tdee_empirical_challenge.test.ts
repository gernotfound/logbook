import { describe, it, expect } from 'vitest';
import { calculateTDEE } from '../../src/lib/calc/nutrition';

describe('R1: TDEE Calculation Adversarial Stress Tests', () => {

    it('excludes noncanonical dates from the seven-day TDEE window without mutating input', () => {
        const current = Array.from({ length: 7 }, (_, i) => ({
            date: `2026-10-${String(i + 1).padStart(2, '0')}`, weight: 80, kcal: 2500,
        }));
        const aliases = ['15/12/2026', '2026-12-1', ' 2026-12-20 ', '2026-12-25T12:00:00']
            .map(date => ({ date, weight: 150, kcal: 9000 }));
        const mixed = [...current, ...aliases];
        const before = structuredClone(mixed);
        expect(calculateTDEE(mixed)).toEqual(calculateTDEE(current));
        expect(calculateTDEE([...current.slice(0, 6), ...aliases])).toEqual({
            error: true, message: 'Raccolta dati in corso... (6/7 giorni richiesti)',
        });
        expect(mixed).toEqual(before);
    });

    // 1.1 Permutation Invariance
    it('R1.1: Guaranteed permutation invariance across 50 pseudo-random shuffles', () => {
        const baseData = [
            { date: '2026-01-01', weight: 80.0, kcal: 2500 },
            { date: '2026-01-02', weight: 80.1, kcal: 2600 },
            { date: '2026-01-03', weight: 79.9, kcal: 2450 },
            { date: '2026-01-04', weight: 80.2, kcal: 2700 },
            { date: '2026-01-05', weight: 80.0, kcal: 2550 },
            { date: '2026-01-06', weight: 80.3, kcal: 2650 },
            { date: '2026-01-07', weight: 80.2, kcal: 2500 },
            { date: '2026-01-08', weight: 80.4, kcal: 2800 },
            { date: '2026-01-09', weight: 80.1, kcal: 2400 },
            { date: '2026-01-10', weight: 80.5, kcal: 2900 },
            { date: '2026-01-11', weight: 80.3, kcal: 2550 },
            { date: '2026-01-12', weight: 80.6, kcal: 2750 },
            { date: '2026-01-13', weight: 80.5, kcal: 2600 },
            { date: '2026-01-14', weight: 80.7, kcal: 2850 },
        ];

        const canonicalResult = calculateTDEE(baseData);
        expect(canonicalResult.error).toBe(false);

        // Test strictly reversed
        const reversedResult = calculateTDEE([...baseData].reverse());
        expect(reversedResult).toEqual(canonicalResult);

        // Test 50 random shuffles with deterministic seed-like swapping
        for (let seed = 1; seed <= 50; seed++) {
            const shuffled = [...baseData];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = (seed * (i + 17)) % (i + 1);
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const res = calculateTDEE(shuffled);
            expect(res).toEqual(canonicalResult);
        }
    });

    // 1.2 Leap Year Transitions (2024 leap year vs 2023 non-leap year)
    it('R1.2: Correctly computes timeSpanDays and TDEE across Leap Year boundaries (Feb 29)', () => {
        // 2024 Leap Year: Feb 25 to Mar 02 (crossing Feb 29) -> 25, 26, 27, 28, 29, Mar 1, Mar 2 (7 days total, 6 days diff)
        const leapData = [
            { date: '2024-02-25', weight: 80.0, kcal: 2500 },
            { date: '2024-02-26', weight: 80.0, kcal: 2500 },
            { date: '2024-02-27', weight: 80.0, kcal: 2500 },
            { date: '2024-02-28', weight: 80.0, kcal: 2500 },
            { date: '2024-02-29', weight: 80.0, kcal: 2500 },
            { date: '2024-03-01', weight: 80.0, kcal: 2500 },
            { date: '2024-03-02', weight: 80.0, kcal: 2500 },
        ];

        const leapRes = calculateTDEE(leapData);
        expect(leapRes.error).toBe(false);
        expect(leapRes.daysTracked).toBe(7);
        expect(leapRes.timeSpanDays).toBe(6); // Feb 25 to Mar 2 = 6 calendar days in 2024
        expect(leapRes.tdee).toBe(2500);

        // 2023 Non-Leap Year: Feb 25 to Mar 02 -> 25, 26, 27, 28, Mar 1, Mar 2 (6 days total, 5 days diff)
        const nonLeapData = [
            { date: '2023-02-25', weight: 80.0, kcal: 2500 },
            { date: '2023-02-26', weight: 80.0, kcal: 2500 },
            { date: '2023-02-27', weight: 80.0, kcal: 2500 },
            { date: '2023-02-28', weight: 80.0, kcal: 2500 },
            { date: '2023-03-01', weight: 80.0, kcal: 2500 },
            { date: '2023-03-02', weight: 80.0, kcal: 2500 },
            { date: '2023-03-03', weight: 80.0, kcal: 2500 },
        ];

        const nonLeapRes = calculateTDEE(nonLeapData);
        expect(nonLeapRes.error).toBe(false);
        expect(nonLeapRes.daysTracked).toBe(7);
        expect(nonLeapRes.timeSpanDays).toBe(6); // Feb 25 to Mar 3 = 6 calendar days
        expect(nonLeapRes.tdee).toBe(2500);
    });

    // 1.3 String numbers with Italian comma format and leading/trailing whitespace
    it('R1.3: Gracefully handles Italian comma decimals, string values, and whitespace', () => {
        const stringData = [
            { date: '2026-05-01', weight: ' 75,5 ', kcal: ' 2450,0 ' },
            { date: '2026-05-02', weight: '75,6', kcal: '2500,5' },
            { date: '2026-05-03', weight: '75,4', kcal: '2400' },
            { date: '2026-05-04', weight: '75,7', kcal: '2600,2' },
            { date: '2026-05-05', weight: 75.5, kcal: 2550 },
            { date: '2026-05-06', weight: '75,8', kcal: '2700' },
            { date: '2026-05-07', weight: ' 76,0 ', kcal: ' 2500 ' },
        ];

        const res = calculateTDEE(stringData);
        expect(res.error).toBe(false);
        expect(res.daysTracked).toBe(7);
        expect(res.weightDiff).toBe('0.50'); // 76.0 - 75.5
        expect(res.timeSpanDays).toBe(6);
        expect(typeof res.tdee).toBe('number');
        expect(!isNaN(res.tdee!)).toBe(true);
    });

    // 1.4 Missing fields, corrupt records, NaNs, negative numbers, 0s
    it('R1.4: Filters out corrupt objects, missing fields, 0 weights/kcals, and negative values', () => {
        const dirtyData = [
            null,
            undefined,
            {},
            { date: '' },
            { date: '2026-06-01', weight: 0, kcal: 2500 }, // 0 weight
            { date: '2026-06-02', weight: -75, kcal: 2500 }, // negative weight
            { date: '2026-06-03', weight: 80, kcal: 0 }, // 0 kcal
            { date: '2026-06-04', weight: 80, kcal: -2000 }, // negative kcal
            { date: '2026-06-05', weight: 'NaN', kcal: 2500 },
            { date: '2026-06-06', weight: 80, kcal: 'invalid' },
            // 7 valid records mixed in
            { date: '2026-06-10', weight: 80, kcal: 2500 },
            { date: '2026-06-11', weight: 80, kcal: 2500 },
            { date: '2026-06-12', weight: 80, kcal: 2500 },
            { date: '2026-06-13', weight: 80, kcal: 2500 },
            { date: '2026-06-14', weight: 80, kcal: 2500 },
            { date: '2026-06-15', weight: 80, kcal: 2500 },
            { date: '2026-06-16', weight: 80, kcal: 2500 },
        ];

        const res = calculateTDEE(dirtyData as any);
        expect(res.error).toBe(false);
        expect(res.daysTracked).toBe(7);
        expect(res.tdee).toBe(2500);
    });

    it('R1.4b: rejects numeric prefixes and non-finite values instead of counting invalid days', () => {
        const valid = Array.from({ length: 6 }, (_, i) => ({
            date: `2026-06-${String(i + 10).padStart(2, '0')}`, weight: 80, kcal: 2500,
        }));
        const invalid = [
            { date: '2026-06-16', weight: '80kg', kcal: 2500 },
            { date: '2026-06-17', weight: 80, kcal: '2500 kcal' },
            { date: '2026-06-18', weight: '0x50', kcal: 2500 },
            { date: '2026-06-19', weight: 80, kcal: '1e309' },
        ];
        const input = [...valid, ...invalid];
        const untouched = structuredClone(input);
        expect(calculateTDEE(input)).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (6/7 giorni richiesti)',
        });
        expect(input).toEqual(untouched);
        expect(calculateTDEE([...valid, { date: '2026-06-16', weight: '80,5', kcal: '2500,5' }]).error).toBe(false);
    });

    // 1.5 Invalid dates are excluded before arithmetic
    it('R1.5: rejects unparseable dates instead of producing NaN TDEE values', () => {
        const dataWithBadDate = [
            { date: 'INVALID_DATE_STRING', weight: 80, kcal: 2500 },
            { date: '2026-06-10', weight: 80, kcal: 2500 },
            { date: '2026-06-11', weight: 80, kcal: 2500 },
            { date: '2026-06-12', weight: 80, kcal: 2500 },
            { date: '2026-06-13', weight: 80, kcal: 2500 },
            { date: '2026-06-14', weight: 80, kcal: 2500 },
            { date: '2026-06-15', weight: 80, kcal: 2500 },
        ];

        expect(calculateTDEE(dataWithBadDate)).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (6/7 giorni richiesti)'
        });
    });

    // 1.6 Boundary test: 0, 1, 6 valid items vs exactly 7, 14, and 20 items (sliding 14-day window)
    it('R1.6: Enforces >= 7 measurement threshold and uses 14-day sliding window correctly', () => {
        expect(calculateTDEE([])).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (0/7 giorni richiesti)'
        });

        expect(calculateTDEE([{ date: '2026-01-01', weight: 70, kcal: 2000 }])).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (1/7 giorni richiesti)'
        });

        // 20 days: window must strictly take the most recent 14 days
        const twentyDays = [];
        for (let i = 1; i <= 20; i++) {
            const dayStr = i < 10 ? `0${i}` : `${i}`;
            twentyDays.push({
                date: `2026-07-${dayStr}`,
                weight: 80 + (i === 1 ? 999 : 0), // Day 1 has outlier weight 1079
                kcal: 3000
            });
        }

        const res20 = calculateTDEE(twentyDays);
        expect(res20.error).toBe(false);
        expect(res20.daysTracked).toBe(14);
        // The first 6 days (including day 1 outlier) should have been sliced off
        expect(res20.weightDiff).toBe('0.00'); // Day 7 to 20 all weight=80
        expect(res20.tdee).toBe(3000);
    });

    it('R1.6b: accepts seven distinct recordings over exactly 14 calendar days', () => {
        const dates = ['2026-08-01', '2026-08-03', '2026-08-05', '2026-08-07', '2026-08-09', '2026-08-11', '2026-08-14'];
        const records = dates.map(date => ({ date, weight: 80, kcal: 2400 }));
        const result = calculateTDEE(records);
        expect(result.error).toBe(false);
        expect(result.tdee).toBe(2400);
        expect(result.daysTracked).toBe(7);
        expect(result.timeSpanDays).toBe(13);
    });

    it('R1.6c: rejects duplicates without inflating the seven-day sample or mutating input', () => {
        const sixDays = Array.from({ length: 6 }, (_, index) => ({
            date: `2026-08-${String(index + 1).padStart(2, '0')}`,
            weight: 80, kcal: 2400,
        }));
        const duplicate = { ...sixDays[0], weight: 100, kcal: 9000 };
        const insufficient = [...sixDays, duplicate];
        const original = structuredClone(insufficient);
        expect(calculateTDEE(insufficient)).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (6/7 giorni richiesti)',
        });
        expect(insufficient).toEqual(original);

        const sevenDays = [...sixDays, { date: '2026-08-07', weight: 80, kcal: 2400 }];
        expect(calculateTDEE(sevenDays).error).toBe(false);
        const ambiguous = [...sevenDays, duplicate];
        expect(calculateTDEE(ambiguous)).toEqual({
            error: true,
            message: 'Campione non valido: registrazioni duplicate per la stessa giornata.',
        });
        expect(ambiguous).toEqual([...sevenDays, duplicate]);
    });

    it('R1.6d: ignores duplicate days outside the sampled calendar window', () => {
        const recent = Array.from({ length: 7 }, (_, index) => ({
            date: `2026-08-${String(index + 1).padStart(2, '0')}`, weight: 80, kcal: 2400,
        }));
        const distantDuplicates = [
            { date: '2026-01-01', weight: 60, kcal: 1000 },
            { date: '2026-01-01', weight: 100, kcal: 7000 },
        ];
        const result = calculateTDEE([...recent, ...distantDuplicates]);
        expect(result.error).toBe(false);
        expect(result.tdee).toBe(2400);
        expect(result.daysTracked).toBe(7);
    });

    // 1.7 Identical dates scenario
    it('R1.7: counts seven repeated records as one valid calendar day', () => {
        const sameDayData = [
            { date: '2026-08-15', weight: 80.0, kcal: 2500 },
            { date: '2026-08-15', weight: 80.1, kcal: 2600 },
            { date: '2026-08-15', weight: 80.2, kcal: 2550 },
            { date: '2026-08-15', weight: 80.0, kcal: 2500 },
            { date: '2026-08-15', weight: 80.3, kcal: 2700 },
            { date: '2026-08-15', weight: 80.1, kcal: 2400 },
            { date: '2026-08-15', weight: 80.2, kcal: 2500 },
        ];

        const res = calculateTDEE(sameDayData);
        expect(res).toEqual({
            error: true,
            message: 'Raccolta dati in corso... (1/7 giorni richiesti)'
        });
    });

    // 1.8 Extreme weight and caloric deltas
    it('R1.8: Correctly computes extreme weight loss / gain surplus physics', () => {
        // Extreme weight loss: -3 kg in 7 days (diffDays = 6) with avg 2000 kcal
        // dailySurplusKcal = (-3 / 6) * 7700 = -3850 kcal/day
        // TDEE = 2000 - (-3850) = 5850 kcal
        const extremeLoss = [
            { date: '2026-09-01', weight: 93.0, kcal: 2000 },
            { date: '2026-09-02', weight: 92.5, kcal: 2000 },
            { date: '2026-09-03', weight: 92.0, kcal: 2000 },
            { date: '2026-09-04', weight: 91.5, kcal: 2000 },
            { date: '2026-09-05', weight: 91.0, kcal: 2000 },
            { date: '2026-09-06', weight: 90.5, kcal: 2000 },
            { date: '2026-09-07', weight: 90.0, kcal: 2000 },
        ];

        const resLoss = calculateTDEE(extremeLoss);
        expect(resLoss.error).toBe(false);
        expect(resLoss.weightDiff).toBe('-3.00');
        expect(resLoss.dailyDeficit).toBe(-3850);
        expect(resLoss.tdee).toBe(5850);
    });
});
