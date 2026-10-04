import { z } from '../zod';
import { 
    safeOptionalString, 
    safeBoolean, 
    safeString,
    reportZodSchemaFallback 
} from './schema_utils';

const PROFILE_STRING_MAX_LENGTH = 128;
const boundedProfileString = () => safeOptionalString().transform(value =>
    value !== undefined && value.length > PROFILE_STRING_MAX_LENGTH ? undefined : value
);

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
    dob: boundedProfileString(),
    height: boundedProfileString(),
    gender: boundedProfileString(),
    neck: boundedProfileString(),
    waist: boundedProfileString(),
    hip: boundedProfileString(),
    hips: boundedProfileString(),
    manualBf: boundedProfileString(),
    chest: boundedProfileString(),
    shoulders: boundedProfileString(),
    biceps: boundedProfileString(),
    thighs: boundedProfileString(),
    calves: boundedProfileString(),
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
