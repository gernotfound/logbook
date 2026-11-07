/** The calorie calculation used when editing macros in CustomFoodForm. */
export function calculateCustomFoodKcal(carbs: unknown, protein: unknown, fat: unknown): number {
    const numeric = (value: unknown): number => {
        const input = String(value ?? '').trim().replace(',', '.');
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input)) return 0;
        const valueAsNumber = Number(input);
        return Number.isFinite(valueAsNumber) ? valueAsNumber : 0;
    };

    const kcal = numeric(carbs) * 4 + numeric(protein) * 4 + numeric(fat) * 9;
    return Number.isFinite(kcal) ? Math.round(kcal) : 0;
}
