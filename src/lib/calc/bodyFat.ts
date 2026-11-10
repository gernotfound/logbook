import { calculateAge } from '../utils/date';

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
    if (m === 'manual') {
        const val = parseFloat(params.bfPercentage !== undefined ? params.bfPercentage : (params.manualBf !== undefined ? params.manualBf : params.bf));
        if (!Number.isFinite(val) || val < 0 || val > 100) return null;
        return Math.round(val * 10) / 10;
    }
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
    if (m === 'bmi') {
        const weight = parseFloat(params.weight);
        const height = parseFloat(params.height);
        if (!Number.isFinite(weight) || !Number.isFinite(height) || weight <= 0 || height <= 0) return null;
        const hMeters = height / 100;
        const bmi = weight / (hMeters * hMeters);
        let age = 30;
        if (params.age !== undefined && Number.isFinite(parseFloat(params.age))) {
            age = parseFloat(params.age);
        } else if (params.dob) {
            age = calculateAge(params.dob);
        }
        const sexFactor = (params.gender === 'F' || params.gender === 'female') ? 0 : 1;
        const bf = (1.20 * bmi) + (0.23 * age) - (10.8 * sexFactor) - 5.4;
        if (!Number.isFinite(bf)) return null;
        return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
    }
    return null;
}

export function calculateBodyFat(weight: any, profile: any): number | null {
    if (!profile || !profile.height || !weight) return null;
    const wKg = parseFloat(weight);
    const hCm = parseFloat(profile.height);
    if (!Number.isFinite(hCm) || !Number.isFinite(wKg) || hCm <= 0 || wKg <= 0) return null;
    const manualBf = parseFloat(profile.manualBf);
    if (Number.isFinite(manualBf) && manualBf >= 0 && manualBf <= 100) return manualBf;
    
    if (profile.gender === 'M' && profile.neck && profile.waist) {
        return calculateUsNavyBodyFat({ gender: 'M', height: hCm, neck: parseFloat(profile.neck), waist: parseFloat(profile.waist), hip: 0 });
    }
    const hipVal = profile.hip;
    if (profile.gender === 'F' && profile.neck && profile.waist && hipVal) {
        return calculateUsNavyBodyFat({ gender: 'F', height: hCm, neck: parseFloat(profile.neck), waist: parseFloat(profile.waist), hip: parseFloat(hipVal) });
    }
    return null;
}
