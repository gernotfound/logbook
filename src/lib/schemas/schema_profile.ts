import { z } from '../zod';
import { 
    safeOptionalString, 
    safeBoolean, 
    safeString,
} from './schema_utils';

const PROFILE_STRING_MAX_LENGTH = 128;

export const UserProfileSchema = z.object({
    dob: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    height: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    gender: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    neck: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    waist: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    hip: safeOptionalString(PROFILE_STRING_MAX_LENGTH).transform(value => value === '' ? undefined : value).optional(),
    chest: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    shoulders: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    biceps: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    thighs: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
    calves: safeOptionalString(PROFILE_STRING_MAX_LENGTH),
}).passthrough().transform(({ hips: _unsupportedHips, manualBf: _unsupportedManualBf, ...profile }) => profile).catch(() => {
    return {};
}).default({});

export const LegalConsentSchema = z.object({
    hasAcceptedTerms: safeBoolean(false),
    hasAcceptedHealthData: safeBoolean(false),
    acceptedAt: safeString(''),
    privacyVersion: safeString(''),
    termsVersion: safeString(''),
}).passthrough().optional().catch(undefined);
