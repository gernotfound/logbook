import { z } from 'zod';
import { 
    safeOptionalString, 
    safeBoolean, 
    safeString,
    reportZodSchemaFallback 
} from './schema_utils';

export const UserProfileSchema = z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
        const hip = (val.hip !== undefined && val.hip !== null && val.hip !== '') ? val.hip : val.hips;
        return {
            ...val,
            hip: hip !== undefined ? hip : undefined,
        };
    }
    return val;
}, z.object({
    dob: safeOptionalString(),
    height: safeOptionalString(),
    gender: safeOptionalString(),
    neck: safeOptionalString(),
    waist: safeOptionalString(),
    hip: safeOptionalString(),
    hips: safeOptionalString(),
    manualBf: safeOptionalString(),
    chest: safeOptionalString(),
    shoulders: safeOptionalString(),
    biceps: safeOptionalString(),
    thighs: safeOptionalString(),
    calves: safeOptionalString(),
}).passthrough()).catch((ctx) => {
    reportZodSchemaFallback({
        schema: 'UserProfileSchema',
        fallbackUsed: 'default_empty_profile',
        error: ctx?.error,
    });
    return {};
}).default({});

export const LegalConsentSchema = z.object({
    hasAcceptedTerms: safeBoolean(false),
    hasAcceptedHealthData: safeBoolean(false),
    acceptedAt: safeString(''),
    privacyVersion: safeString(''),
    termsVersion: safeString(''),
}).passthrough().optional().catch(undefined);
