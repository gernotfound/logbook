/** The calorie calculation used when editing macros in CustomFoodForm. */
export function calculateCustomFoodKcal(carbs: unknown, protein: unknown, fat: unknown): number {
    const numeric = (value: unknown): number =>
        parseFloat(String(value ?? '').trim().replace(',', '.')) || 0;
    return Math.round(numeric(carbs) * 4 + numeric(protein) * 4 + numeric(fat) * 9);
}
