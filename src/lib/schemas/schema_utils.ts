import { z } from '../zod';
import { formatSleepTime } from '../utils/date';

// Defensive conversion helpers for robust runtime sanitization
export const safeOptionalSleepTime = () =>
    z.string().transform(v => {
        const formatted = formatSleepTime(v);
        return formatted || undefined;
    }).optional().catch(undefined);

export const safeNumber = (defaultVal = 0) =>
    z.union([
        z.number().finite(),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return defaultVal;
            const num = Number(trimmed);
            return Number.isFinite(num) ? num : defaultVal;
        })
    ]).catch(defaultVal).default(defaultVal);

export const safeOptionalNumber = () =>
    z.union([
        z.number().finite(),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return undefined;
            const num = Number(trimmed);
            return Number.isFinite(num) ? num : undefined;
        })
    ]).optional().catch(undefined);

export const safeOptionalNullableNumber = () =>
    z.union([
        z.number().finite(),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return null;
            const num = Number(trimmed);
            return Number.isFinite(num) ? num : null;
        }),
        z.null()
    ]).optional().catch(null);

export const safeString = (defaultVal = '') =>
    z.union([
        z.string(),
        z.number().transform(v => String(v)),
    ]).catch(defaultVal).default(defaultVal);

export const safeOptionalString = (maxLength?: number) => {
    const stringSchema = maxLength === undefined ? z.string() : z.string().max(maxLength);
    return z.union([
        stringSchema,
        z.number()
            .transform(v => String(v))
            .refine(v => maxLength === undefined || v.length <= maxLength),
    ]).optional().catch(undefined);
};

export const safeBoolean = (defaultVal = false) =>
    z.union([
        z.boolean(),
        z.string().transform(v => v === 'true' || v === '1'),
        z.number().transform(v => v === 1),
    ]).catch(defaultVal).default(defaultVal);

export const safeOptionalBoolean = () =>
    z.union([
        z.boolean(),
        z.string().transform(v => v === 'true' || v === '1'),
        z.number().transform(v => v === 1),
    ]).optional().catch(undefined);
