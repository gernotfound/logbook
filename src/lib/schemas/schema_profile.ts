import { z } from '../zod';
import { 
    safeOptionalString, 
    safeBoolean, 
    safeString,
    reportZodSchemaFallback 
} from './schema_utils';

const PROFILE_STRING_MAX_LENGTH = 128;

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
    dob: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    height: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    gender: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    neck: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    waist: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    hip: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    hips: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    manualBf: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    chest: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    shoulders: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    biceps: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    thighs: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    calves: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
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
