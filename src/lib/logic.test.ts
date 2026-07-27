import { describe, it, expect } from 'vitest';
import { Logic } from './logic';

describe('Logic Library Tests', () => {
    
    it('calculateMacrosFromKg: calculates correct macros based on body weight', () => {
        const weight = 80;
        const carbsPerKg = 3.5;
        const proPerKg = 2.0;
        const fatPerKg = 1.0;
        
        const macros = Logic.calculateMacrosFromKg(weight, carbsPerKg, proPerKg, fatPerKg);
        
        expect(macros.carbsGrams).toBeCloseTo(80 * 3.5); // 280
        expect(macros.proGrams).toBeCloseTo(80 * 2.0);   // 160
        expect(macros.fatGrams).toBeCloseTo(80 * 1.0);   // 80
        
        // 280*4 + 160*4 + 80*9 = 1120 + 640 + 720 = 2480
        expect(macros.totalKcal).toBeCloseTo(2480);
    });

    it('calculateBodyFat: calculates BMI-based body fat for Male correctly', () => {
        const weight = 80; // kg
        const profile = {
            gender: 'M',
            height: 180, // cm
            dob: '1995-01-01'
        };
        // Expected BF based on BMI formula
        const bf = Logic.calculateBodyFat(weight, profile);
        expect(Number(bf)).toBeGreaterThan(10);
        expect(Number(bf)).toBeLessThan(25);
    });

    it('calculateBodyFat: calculates BMI-based body fat for Female correctly', () => {
        const weight = 65; // kg
        const profile = {
            gender: 'F',
            height: 165, // cm
            dob: '1995-01-01'
        };
        const bf = Logic.calculateBodyFat(weight, profile);
        expect(Number(bf)).toBeGreaterThan(15);
        expect(Number(bf)).toBeLessThan(35);
    });

    it('calculateTDEE: estimates TDEE correctly from chronoData', () => {
        // Mock 14 days of data with steady weight and exactly 2500 kcal intake
        const chronoData = [];
        for (let i = 0; i < 14; i++) {
            const date = new Date(2023, 0, i + 1).toISOString().split('T')[0];
            chronoData.push({
                date,
                kcal: 2500,
                weight: 80 // weight doesn't change
            });
        }

        const tdee = Logic.calculateTDEE(chronoData);
        expect(tdee.error).toBe(false);
        expect(Number(tdee.tdee)).toBe(2500); // Because weight is steady, TDEE = intake
        expect(Number(tdee.weightDiff)).toBe(0);
    });

    it('calculateTDEE: estimates TDEE correctly when gaining weight', () => {
        // Mock 14 days of data, eating 3000 kcal, weight goes from 80 to 81 (+1kg in 14 days)
        // 1kg of tissue = ~7000 kcal surplus. 7000 / 14 days = 500 kcal surplus/day.
        // If intake is 3000, TDEE should be 3000 - 500 = 2500.
        const chronoData = [];
        for (let i = 0; i < 14; i++) {
            const date = new Date(2023, 0, i + 1).toISOString().split('T')[0];
            chronoData.push({
                date,
                kcal: 3000,
                weight: 80 + (i * (1/13)) // linear increase from 80 to 81
            });
        }
        // Force the first and last to be exactly 80 and 81 to avoid floating math issues
        chronoData[0].weight = 80;
        chronoData[13].weight = 81;

        const tdee = Logic.calculateTDEE(chronoData);
        expect(tdee.error).toBe(false);
        // Depending on exact formula (sometimes uses 7700 instead of 7000)
        // Let's assume it's in the ballpark of 2400-2600
        expect(tdee.tdee).toBeGreaterThan(2300);
        expect(tdee.tdee).toBeLessThan(2700);
    });

    it('getLocalDateString: formats local date YYYY-MM-DD correctly', () => {
        const testDate = new Date(2026, 6, 26); // July 26, 2026
        const dateStr = Logic.getLocalDateString(testDate);
        expect(dateStr).toBe('2026-07-26');
    });

    it('scaleFoodNutrients: returns zero nutrients when quantity is 0', () => {
        const food = { baseQty: 100, kcal: 200, carbs: 30, pro: 10, fat: 5, unit: 'g' };
        const scaled = Logic.scaleFoodNutrients(food, 0, 'g');
        expect(scaled.kcal).toBe(0);
        expect(scaled.carbs).toBe(0);
        expect(scaled.pro).toBe(0);
        expect(scaled.fat).toBe(0);
    });

    it('calculateNormocaloricaDiff: calculates percentages and returns carbsPct, proPct, fatPct, kcalPct', () => {
        const current = { carbsGrams: 300, proGrams: 160, fatGrams: 70, totalKcal: 2470 };
        const normocalorica = { carbs: 250, pro: 150, fat: 60, kcal: 2140 };
        const diff = Logic.calculateNormocaloricaDiff(current, normocalorica);
        expect(diff!.carbsPct).toBeGreaterThan(0);
        expect(diff!.proPct).toBeGreaterThan(0);
        expect(diff!.fatPct).toBeGreaterThan(0);
        expect(diff!.kcalPct).toBeGreaterThan(0);
    });
});
