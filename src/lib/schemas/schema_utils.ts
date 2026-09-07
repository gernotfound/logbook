import { z } from 'zod';
import { formatSleepTime } from '../utils/date';
import { telemetryHub } from '../telemetryHub';

export interface ZodFallbackContext {
    schema: string;
    field?: string;
    fallbackUsed?: string;
    expectedType?: string;
    receivedType?: string;
    issueCode?: string;
    error?: unknown;
}

export type SchemaFallbackListener = (context: ZodFallbackContext) => void;
let customFallbackListener: SchemaFallbackListener | null = null;

export function setSchemaFallbackListener(listener: SchemaFallbackListener | null): void {
    customFallbackListener = listener;
}

export function reportZodSchemaFallback(ctx: ZodFallbackContext): void {
    try {
        if (customFallbackListener) {
            try {
                customFallbackListener(ctx);
            } catch {
                // Safe fail-through
            }
        }

        if (typeof telemetryHub === 'undefined' || !telemetryHub) return;

        let expectedType = ctx.expectedType;
        let receivedType = ctx.receivedType;
        let issueCode = ctx.issueCode;
        let fieldPath = ctx.field;

        if (ctx.error && typeof ctx.error === 'object' && 'issues' in (ctx.error as any)) {
            const issues = (ctx.error as any).issues;
            if (Array.isArray(issues) && issues.length > 0) {
                const first = issues[0];
                if (first) {
                    if (!issueCode) issueCode = first.code || 'validation_error';
                    if (!fieldPath && Array.isArray(first.path) && first.path.length > 0) {
                        fieldPath = first.path.join('.');
                    }
                    if (!expectedType && 'expected' in first && first.expected !== undefined) {
                        expectedType = String(first.expected);
                    }
                    if (!receivedType && 'received' in first && first.received !== undefined) {
                        receivedType = String(first.received);
                    }
                }
            }
        }

        const safeIssueCode = issueCode || 'validation_fallback';
        const safeField = fieldPath || 'root';
        const safeFallback = ctx.fallbackUsed || 'default';

        const typeInfo = (expectedType && receivedType) ? ` (expected ${expectedType}, received ${receivedType})` : '';
        const syntheticMessage = `Zod fallback in ${ctx.schema} [${safeField}]: ${safeIssueCode}${typeInfo}`;

        // 1. Dispatch Telemetry Event (without raw corrupted values or PII)
        if (typeof telemetryHub.trackEvent === 'function') {
            telemetryHub.trackEvent('zod_schema_fallback', {
                schema: ctx.schema,
                field: safeField,
                issueCode: safeIssueCode,
                expectedType: expectedType || 'unknown',
                receivedType: receivedType || 'unknown',
                fallbackUsed: safeFallback,
            });
        }

        // 2. Dispatch Telemetry Error (deduplicated by telemetryHub)
        if (typeof telemetryHub.trackError === 'function') {
            const fallbackError = new Error(syntheticMessage);
            fallbackError.name = 'ZodSchemaFallbackError';
            telemetryHub.trackError(fallbackError, {
                source: 'zod_schema_fallback',
                customMessage: syntheticMessage,
            });
        }
    } catch {
        // Safe non-blocking guarantee: schema parsing must never fail because of telemetry
    }
}

// Defensive conversion helpers for robust runtime sanitization
export const safeOptionalSleepTime = () =>
    z.string().transform(v => {
        const trimmed = v.trim();
        if (!trimmed) return undefined;
        const formatted = formatSleepTime(trimmed);
        return formatted || undefined;
    }).optional().catch(undefined);

export const safeNumber = (defaultVal = 0) =>
    z.union([
        z.number().refine(v => !isNaN(v), { message: "NaN is not a valid number" }),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return defaultVal;
            const num = Number(trimmed);
            return isNaN(num) ? defaultVal : num;
        })
    ]).catch(defaultVal).default(defaultVal);

export const safeOptionalNumber = () =>
    z.union([
        z.number().refine(v => !isNaN(v), { message: "NaN is not a valid number" }),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return undefined;
            const num = Number(trimmed);
            return isNaN(num) ? undefined : num;
        })
    ]).optional().catch(undefined);

export const safeOptionalNullableNumber = () =>
    z.union([
        z.number().refine(v => !isNaN(v)),
        z.string().transform(v => {
            const trimmed = v.trim();
            if (trimmed === '') return null;
            const num = Number(trimmed);
            return isNaN(num) ? null : num;
        }),
        z.null()
    ]).optional().catch(null);

export const safeString = (defaultVal = '') =>
    z.union([
        z.string(),
        z.number().transform(v => String(v)),
    ]).catch(defaultVal).default(defaultVal);

export const safeOptionalString = () =>
    z.union([
        z.string(),
        z.number().transform(v => String(v)),
    ]).optional().catch(undefined);

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
