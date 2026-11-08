// Above this magnitude, adjacent IEEE-754 values are at least 0.125 apart.
// Rounding to a tenth therefore cannot change the representable value; scaling
// by ten would instead introduce precision loss or overflow.
export function roundToTenth(value: number): number {
    return Math.abs(value) >= 2 ** 49 ? value : Math.round(value * 10) / 10;
}
