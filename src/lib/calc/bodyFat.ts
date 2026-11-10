function calculateUsNavyBodyFat({ gender, height, waist, neck, hip }: { gender?: string; height: any; waist: any; neck: any; hip?: any }): number | null {
    const h = parseFloat(height);
    const w = parseFloat(waist);
    const n = parseFloat(neck);
    const hp = parseFloat(hip);
    const g = (gender || 'M').toUpperCase();
    if (![h, w, n].every(Number.isFinite) || h < 50 || h > 250 || w <= 0 || n <= 0) return null;
    if (g === 'M') {
        if (w <= n) return null;
        const logWaistNeck = Math.log10(w - n);
        const logHeight = Math.log10(h);
        const denom = 1.0324 - (0.19077 * logWaistNeck) + (0.15456 * logHeight);
        if (!Number.isFinite(denom) || denom <= 0) return null;
        const bf = (495 / denom) - 450;
        return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
    } else if (g === 'F') {
        if (!Number.isFinite(hp) || hp <= 0 || (w + hp) <= n) return null;
        const logWaistHipNeck = Math.log10(w + hp - n);
        const logHeight = Math.log10(h);
        const denom = 1.29579 - (0.35004 * logWaistHipNeck) + (0.22100 * logHeight);
        if (!Number.isFinite(denom) || denom <= 0) return null;
        const bf = (495 / denom) - 450;
        return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
    }
    return null;
}

export function calculateBodyFatByMethod(method: any, params: any): number | null {
    if (!method || !params || typeof params !== 'object') return null;
    const m = (method || '').toString().toLowerCase().trim();
    if (m === 'navy_male') {
        const height = parseFloat(params.height);
        const waist = parseFloat(params.waist);
        const neck = parseFloat(params.neck);
        return calculateUsNavyBodyFat({ gender: 'M', height, waist, neck, hip: 0 });
    }
    if (m === 'navy_female') {
        const height = parseFloat(params.height);
        const waist = parseFloat(params.waist);
        const neck = parseFloat(params.neck);
        const hip = parseFloat(params.hip);
        return calculateUsNavyBodyFat({ gender: 'F', height, waist, neck, hip });
    }
    return null;
}

export function calculateBodyFat(weight: any, profile: any): number | null {
    if (!profile || !profile.height || !weight) return null;
    const wKg = parseFloat(weight);
    const hCm = parseFloat(profile.height);
    if (!Number.isFinite(hCm) || !Number.isFinite(wKg) || hCm <= 0 || wKg <= 0) return null;
    
    if (profile.gender === 'M' && profile.neck && profile.waist) {
        return calculateUsNavyBodyFat({ gender: 'M', height: hCm, neck: parseFloat(profile.neck), waist: parseFloat(profile.waist), hip: 0 });
    }
    const hipVal = profile.hip;
    if (profile.gender === 'F' && profile.neck && profile.waist && hipVal) {
        return calculateUsNavyBodyFat({ gender: 'F', height: hCm, neck: parseFloat(profile.neck), waist: parseFloat(profile.waist), hip: parseFloat(hipVal) });
    }
    return null;
}
