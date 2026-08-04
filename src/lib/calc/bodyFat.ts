export function calculateUsNavyBodyFat({ gender, height, waist, neck, hip }: { gender?: string; height: any; waist: any; neck: any; hip?: any }): number | null {
    const h = parseFloat(height);
    const w = parseFloat(waist);
    const n = parseFloat(neck);
    const hp = parseFloat(hip);
    const g = (gender || 'M').toUpperCase();
    if (isNaN(h) || isNaN(w) || isNaN(n) || h < 50 || h > 250 || w <= 0 || n <= 0) return null;
    if (g === 'M') {
        if (w <= n) return null;
        const logWaistNeck = Math.log10(w - n);
        const logHeight = Math.log10(h);
        const denom = 1.0324 - (0.19077 * logWaistNeck) + (0.15456 * logHeight);
        if (denom <= 0) return null;
        const bf = (495 / denom) - 450;
        return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
    } else if (g === 'F') {
        if (isNaN(hp) || hp <= 0 || (w + hp) <= n) return null;
        const logWaistHipNeck = Math.log10(w + hp - n);
        const logHeight = Math.log10(h);
        const denom = 1.29579 - (0.35004 * logWaistHipNeck) + (0.22100 * logHeight);
        if (denom <= 0) return null;
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
        if (isNaN(val) || val < 0 || val > 100) return null;
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
        if (isNaN(weight) || isNaN(height) || weight <= 0 || height <= 0) return null;
        const hMeters = height / 100;
        const bmi = weight / (hMeters * hMeters);
        let age = 30;
        if (params.age !== undefined && !isNaN(parseFloat(params.age))) {
            age = parseFloat(params.age);
        } else if (params.dob) {
            const dobDate = new Date(params.dob);
            if (!isNaN(dobDate.getTime())) {
                age = Math.abs(new Date(Date.now() - dobDate.getTime()).getUTCFullYear() - 1970);
            }
        }
        const sexFactor = (params.gender === 'F' || params.gender === 'female') ? 0 : 1;
        const bf = (1.20 * bmi) + (0.23 * age) - (10.8 * sexFactor) - 5.4;
        if (isNaN(bf)) return null;
        return Math.max(2, Math.min(60, Math.round(bf * 10) / 10));
    }
    return null;
}

export function calculateBodyFat(weight: any, profile: any): number | null {
    if (!profile || !profile.height || !weight) return null;
    if (profile.manualBf) return profile.manualBf;
    const wKg = parseFloat(weight);
    const hCm = parseFloat(profile.height);
    if (hCm <= 0 || wKg <= 0) return null;
    
    if (profile.gender === 'M' && profile.neck && profile.waist) {
        return calculateUsNavyBodyFat({ gender: 'M', height: hCm, neck: parseFloat(profile.neck), waist: parseFloat(profile.waist), hip: 0 });
    }
    if (profile.gender === 'F' && profile.neck && profile.waist && profile.hip) {
        return calculateUsNavyBodyFat({ gender: 'F', height: hCm, neck: parseFloat(profile.neck), waist: parseFloat(profile.waist), hip: parseFloat(profile.hip) });
    }
    return null;
}

export function calculateBodyComposition(weight: any, bfPercentage: any): { fatMass: number; leanMass: number } {
    const w = parseFloat(weight);
    const bf = parseFloat(bfPercentage);
    if (isNaN(w) || isNaN(bf) || w <= 0 || bf < 0 || bf > 100) {
        return { fatMass: 0, leanMass: 0 };
    }
    const fatMass = Math.round(w * (bf / 100) * 10) / 10;
    const leanMass = Math.round((w - fatMass) * 10) / 10;
    return { fatMass, leanMass };
}

export function validateMeasurementData(data: any) {
    const errors: Record<string, string> = {};
    if (!data || typeof data !== 'object') {
        return { isValid: false, errors: { general: "Dati non validi" }, cleanData: null, bfPercentage: null };
    }
    const dateStr = String(data.date || '').trim();
    if (!dateStr || isNaN(Date.parse(dateStr))) {
        errors.date = "Data non valida (richiesto formato AAAA-MM-GG)";
    }
    const weight = parseFloat(data.weight);
    if (isNaN(weight) || weight <= 0) {
        errors.weight = "Il peso corporeo deve essere maggiore di 0 kg";
    }
    const method = (data.method || data.measurementMethod || 'manual').toLowerCase().trim();
    const validMethods = ['manual', 'navy_male', 'navy_female', 'bmi'];
    if (!validMethods.includes(method)) {
        errors.method = "Metodo di misurazione non supportato";
    }
    const height = parseFloat(data.height);
    const neck = parseFloat(data.neck);
    const waist = parseFloat(data.waist);
    const hip = parseFloat(data.hip);
    const manualBf = parseFloat(data.manualBf !== undefined ? data.manualBf : data.bfPercentage);
    if (method === 'manual') {
        if (isNaN(manualBf) || manualBf < 0 || manualBf > 100) {
            errors.manualBf = "La percentuale di massa grassa manuale deve essere compresa tra 0% e 100%";
        }
    } else if (method === 'navy_male') {
        if (isNaN(height) || height <= 0) errors.height = "Altezza richiesta e maggiore di 0 cm";
        if (isNaN(neck) || neck <= 0) errors.neck = "Circonferenza collo richiesta e maggiore di 0 cm";
        if (isNaN(waist) || waist <= 0) errors.waist = "Circonferenza vita richiesta e maggiore di 0 cm";
        if (!errors.waist && !errors.neck && waist <= neck) {
            errors.waist = "La circonferenza vita deve essere maggiore del collo";
        }
    } else if (method === 'navy_female') {
        if (isNaN(height) || height <= 0) errors.height = "Altezza richiesta e maggiore di 0 cm";
        if (isNaN(neck) || neck <= 0) errors.neck = "Circonferenza collo richiesta e maggiore di 0 cm";
        if (isNaN(waist) || waist <= 0) errors.waist = "Circonferenza vita richiesta e maggiore di 0 cm";
        if (isNaN(hip) || hip <= 0) errors.hip = "Circonferenza fianchi richiesta e maggiore di 0 cm";
        if (!errors.waist && !errors.hip && !errors.neck && (waist + hip <= neck)) {
            errors.hip = "La somma di vita e fianchi deve essere maggiore del collo";
        }
    } else if (method === 'bmi') {
        if (isNaN(height) || height <= 0) errors.height = "Altezza richiesta e maggiore di 0 cm";
    }
    const isValid = Object.keys(errors).length === 0;
    if (!isValid) {
        return { isValid: false, errors, cleanData: null, bfPercentage: null };
    }
    const bfPercentage = calculateBodyFatByMethod(method, {
        bfPercentage: manualBf,
        manualBf,
        weight,
        height,
        neck,
        waist,
        hip,
        age: data.age,
        dob: data.dob,
        gender: data.gender
    });
    if (bfPercentage === null) {
        errors.bfPercentage = "Impossibile calcolare la % di massa grassa con i dati forniti";
        return { isValid: false, errors, cleanData: null, bfPercentage: null };
    }
    const cleanData = {
        date: dateStr,
        weight: Math.round(weight * 10) / 10,
        measurementMethod: method,
        bfPercentage,
        measurements: {
            height: !isNaN(height) && height > 0 ? Math.round(height * 10) / 10 : null,
            neck: !isNaN(neck) && neck > 0 ? Math.round(neck * 10) / 10 : null,
            waist: !isNaN(waist) && waist > 0 ? Math.round(waist * 10) / 10 : null,
            hip: !isNaN(hip) && hip > 0 ? Math.round(hip * 10) / 10 : null,
            manualBf: !isNaN(manualBf) && manualBf >= 0 ? Math.round(manualBf * 10) / 10 : null
        }
    };
    return { isValid: true, errors: {}, cleanData, bfPercentage };
}
