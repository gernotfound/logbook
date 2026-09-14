export class SeededRandom {
    private state: number;

    constructor(seed: number) {
        this.state = (seed >>> 0) || 0x6d2b79f5;
    }

    private nextUint32(): number {
        let x = this.state;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.state = x >>> 0;
        return this.state;
    }

    int(maxExclusive: number): number {
        if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
            throw new Error(`maxExclusive must be a positive integer, got ${maxExclusive}`);
        }
        return this.nextUint32() % maxExclusive;
    }

    bool(numerator = 1, denominator = 2): boolean {
        if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0 || numerator < 0 || numerator > denominator) {
            throw new Error(`Invalid probability ${numerator}/${denominator}`);
        }
        return this.int(denominator) < numerator;
    }

    pick<T>(values: readonly T[]): T {
        if (values.length === 0) throw new Error('Cannot pick from an empty collection');
        return values[this.int(values.length)];
    }

    shuffle<T>(values: readonly T[]): T[] {
        const result = [...values];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
}

type ProcessLike = { env?: Record<string, string | undefined> };

function fuzzEnv(): Record<string, string | undefined> {
    return (globalThis as typeof globalThis & { process?: ProcessLike }).process?.env ?? {};
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`);
    return parsed;
}

export function runProperty(
    name: string,
    defaultCases: number,
    property: (rng: SeededRandom, seed: number) => void,
): void {
    const env = fuzzEnv();
    const forcedSeed = parsePositiveInteger(env.LOGBOOK_FUZZ_SEED, 'LOGBOOK_FUZZ_SEED');
    const requestedCases = parsePositiveInteger(env.LOGBOOK_FUZZ_CASES, 'LOGBOOK_FUZZ_CASES');
    const cases = forcedSeed ? 1 : (requestedCases ?? defaultCases);

    for (let index = 0; index < cases; index++) {
        const seed = forcedSeed ?? ((0x9e3779b9 + Math.imul(index + 1, 0x85ebca6b)) >>> 0) || 1;
        try {
            property(new SeededRandom(seed), seed);
        } catch (error) {
            throw new Error(
                `${name} failed at seed=${seed} (case ${index + 1}/${cases}). ` +
                `Reproduce with LOGBOOK_FUZZ_SEED=${seed} npm run test:fuzz`,
                { cause: error },
            );
        }
    }
}
