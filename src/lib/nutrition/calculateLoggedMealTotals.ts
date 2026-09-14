export function calculateLoggedMealTotals(meals: any[]) {
    let kcal = 0, carbs = 0, pro = 0, fat = 0;
    for (const m of meals ?? []) {
        const base = m.baseQty != null && m.baseQty > 0
            ? m.baseQty
            : (m.unit === 'porzione' || m.meal === 'quick' ? 1 : 100);
        const qty = m.quantity != null ? m.quantity : base;
        const ratio = base > 0 ? qty / base : 1;
        kcal += (Number(m.kcal) || 0) * ratio;
        carbs += (Number(m.carbs) || 0) * ratio;
        pro += (Number(m.pro) || 0) * ratio;
        fat += (Number(m.fat) || 0) * ratio;
    }
    return {
        kcal: Math.round(kcal),
        carbs: Math.round(carbs * 10) / 10,
        pro: Math.round(pro * 10) / 10,
        fat: Math.round(fat * 10) / 10,
    };
}
