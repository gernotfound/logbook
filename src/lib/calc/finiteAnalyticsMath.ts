// Individually finite observations may overflow when added or rounded.
// A failed addition is not a zero-valued measurement.
export function finiteSum(total: number, value: number): number | null {
    const next = total + value;
    return Number.isFinite(next) ? next : null;
}

export function addFiniteVolume(total: number, value: number): number {
    return finiteSum(total, value) ?? total;
}

export function roundFinite(value: number, factor: number): number {
    const scaled = value * factor;
    return Number.isFinite(scaled) ? Math.round(scaled) / factor : value;
}
