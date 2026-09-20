/**
 * LogBook - Privacy Sanitization & Telemetry Context Engine
 */

export type DerivedPlatform = 'ios' | 'ipados' | 'other';
export type DisplayMode = 'standalone' | 'browser';

export interface TelemetryContext {
  appVersion: string;
  platform: DerivedPlatform;
  displayMode: DisplayMode;
  online: boolean;
}

export interface SanitizedErrorData {
  type: string;
  message: string;
  stack?: string;
  source: string;
  componentStack?: string;
}

export const APP_VERSION = __APP_VERSION__;

const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const EMAIL_TEST_REGEX = /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
const IPV6_REGEX = /(?<![0-9a-fA-F:])(?:(?:(?:::|(?:[0-9a-fA-F]{1,4}:)+|(?:[0-9a-fA-F]{1,4}:)+:)(?:[0-9a-fA-F]{1,4}:)*(?:\d{1,3}\.){3}\d{1,3})|(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4})|(?:::|(?:[0-9a-fA-F]{1,4}:)+:)(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?|(?:[0-9a-fA-F]{1,4}:){1,7}:)(?![0-9a-fA-F:])/g;
const BEARER_REGEX = /\b[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9\-._~+/]+=*/g;
const FIREBASE_API_KEY_REGEX = /\bAIza[0-9A-Za-z\-_]{35}\b/g;
const JWT_REGEX = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]*)?\b/g;
const WIN_USER_PATH_REGEX = /[a-zA-Z]:[/\\](?:Users|users|Documents and Settings|documents and settings)[/\\][^\s"':<>,;]+/g;
const UNIX_USER_PATH_REGEX = /(?:\/home|\/[Uu]sers)\/[a-zA-Z0-9_.-]+(?:\/[^\s"':<>,;]+)*/g;
const SENSITIVE_KV_REGEX = /([?&"'])(password|token|secret|apiKey|auth|code|accessToken|refreshToken)=([^&"'\s]+)/gi;
const SENSITIVE_JSON_KV_REGEX = /(["']?(?:password|token|secret|apiKey|auth|accessToken|refreshToken)["']?\s*:\s*["'])([^"'\r\n]+)(["'])/gi;

const BEARER_TEST_REGEX = /bearer\s+/i;
const IPV4_TEST_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_TEST_REGEX = /::|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){6}\d{1,3}\./;
const SENSITIVE_KV_TEST_REGEX = /[?&"'](?:password|token|secret|apiKey|auth|code|accessToken|refreshToken)=/i;
const SENSITIVE_JSON_TEST_REGEX = /(?:password|token|secret|apiKey|auth|accessToken|refreshToken)/i;

/**
 * Scrubs personally identifiable information (PII) and sensitive secrets from text.
 */
export function scrubPII(text: string): string {
  if (typeof text !== 'string') {
    if (text === null || text === undefined) return '';
    try {
      text = String(text);
    } catch {
      return '';
    }
  }

  if (text === '') return '';

  let scrubbed = text;

  // Fast-path: return immediately if no structural punctuation triggers exist
  if (
    !scrubbed.includes(':') &&
    !scrubbed.includes('/') &&
    !scrubbed.includes('\\') &&
    !scrubbed.includes('@') &&
    !scrubbed.includes('=') &&
    !scrubbed.includes('.')
  ) {
    if (!scrubbed.includes('AIza') && !scrubbed.includes('earer') && !scrubbed.includes('EARER')) {
      return scrubbed;
    }
  }

  if (scrubbed.includes('@')) {
    if (EMAIL_TEST_REGEX.test(scrubbed)) {
      scrubbed = scrubbed.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
    }
  }

  if (scrubbed.includes('earer') || scrubbed.includes('EARER')) {
    if (BEARER_TEST_REGEX.test(scrubbed)) {
      scrubbed = scrubbed.replace(BEARER_REGEX, 'Bearer [REDACTED_TOKEN]');
    }
  }

  if (scrubbed.includes('AIza')) {
    scrubbed = scrubbed.replace(FIREBASE_API_KEY_REGEX, '[REDACTED_TOKEN]');
  }

  if (scrubbed.includes('eyJ')) {
    scrubbed = scrubbed.replace(JWT_REGEX, '[REDACTED_TOKEN]');
  }

  if (scrubbed.includes(':')) {
    if (scrubbed.includes('::') || IPV6_TEST_REGEX.test(scrubbed)) {
      scrubbed = scrubbed.replace(IPV6_REGEX, '[REDACTED_IP]');
    }
  }

  if (scrubbed.includes('.')) {
    if (IPV4_TEST_REGEX.test(scrubbed)) {
      scrubbed = scrubbed.replace(IPV4_REGEX, '[REDACTED_IP]');
    }
  }

  if (
    scrubbed.includes('Users') ||
    scrubbed.includes('users') ||
    scrubbed.includes('/home') ||
    scrubbed.includes('documents and settings') ||
    scrubbed.includes('Documents and Settings')
  ) {
    if (scrubbed.includes(':\\') || scrubbed.includes(':/')) {
      scrubbed = scrubbed.replace(WIN_USER_PATH_REGEX, '[REDACTED_PATH]');
    }
    if (scrubbed.includes('/home') || scrubbed.includes('/Users') || scrubbed.includes('/users')) {
      scrubbed = scrubbed.replace(UNIX_USER_PATH_REGEX, '[REDACTED_PATH]');
    }
  }

  if (scrubbed.includes('=')) {
    if (SENSITIVE_KV_TEST_REGEX.test(scrubbed)) {
      scrubbed = scrubbed.replace(SENSITIVE_KV_REGEX, '$1$2=[REDACTED]');
    }
  }

  if (
    scrubbed.includes('password') ||
    scrubbed.includes('Password') ||
    scrubbed.includes('token') ||
    scrubbed.includes('Token') ||
    scrubbed.includes('secret') ||
    scrubbed.includes('Secret') ||
    scrubbed.includes('apiKey') ||
    scrubbed.includes('auth') ||
    scrubbed.includes('Auth')
  ) {
    if (SENSITIVE_JSON_TEST_REGEX.test(scrubbed)) {
      scrubbed = scrubbed.replace(SENSITIVE_JSON_KV_REGEX, '$1[REDACTED]$3');
    }
  }

  return scrubbed;
}

/**
 * Truncates a stack trace string to a maximum character length after PII scrubbing.
 */
export function truncateStack(stack?: string, maxLength: number = 1000): string | undefined {
  if (stack === undefined || stack === null) {
    return undefined;
  }
  if (typeof stack !== 'string') {
    return undefined;
  }
  if (stack === '') {
    return '';
  }

  const marker = '...[TRUNCATED]';
  const stackLen = stack.length;
  if (maxLength <= 14) {
    return scrubPII(stack.slice(0, maxLength)).slice(0, maxLength);
  }

  const isTruncated = stackLen > maxLength;
  const targetLength = maxLength - 14;
  const rawChunk = isTruncated ? stack.slice(0, targetLength) : stack;
  const scrubbed = scrubPII(rawChunk);

  if (isTruncated) {
    return scrubbed.length > targetLength ? scrubbed.slice(0, targetLength) + marker : scrubbed + marker;
  }

  return scrubbed.length <= maxLength ? scrubbed : scrubbed.slice(0, targetLength) + marker;
}

/**
 * Derives a privacy-minimized platform descriptor ('ios' | 'ipados' | 'other').
 */
export function detectDerivedPlatform(nav?: Navigator): DerivedPlatform {
  try {
    const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (!n) return 'other';
    const ua = typeof n.userAgent === 'string' ? n.userAgent : '';
    const platform = typeof n.platform === 'string' ? n.platform : '';
    const maxTouchPoints = typeof n.maxTouchPoints === 'number' && !isNaN(n.maxTouchPoints) ? n.maxTouchPoints : 0;

    // iPadOS check (iPad in UA/platform or MacIntel / Macintosh with touch points)
    if (
      /iPad/i.test(ua) ||
      /iPad/i.test(platform) ||
      (platform === 'MacIntel' && maxTouchPoints > 1) ||
      (/Macintosh/i.test(ua) && maxTouchPoints > 1)
    ) {
      return 'ipados';
    }

    // iPhone / iPod check
    if (/iPhone|iPod/i.test(ua) || /iPhone|iPod/i.test(platform)) {
      return 'ios';
    }

    return 'other';
  } catch {
    return 'other';
  }
}

/**
 * Detects whether the app is running in standalone mode (PWA / installed).
 */
export function isStandaloneMode(win?: Window): boolean {
  try {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return false;
    const isIosStandalone = (w.navigator as any)?.standalone === true;
    let isMediaStandalone = false;
    if (typeof w.matchMedia === 'function') {
      try {
        const mq = w.matchMedia('(display-mode: standalone)');
        isMediaStandalone = mq ? (mq.matches ?? false) : false;
      } catch {
        isMediaStandalone = false;
      }
    }
    return Boolean(isIosStandalone || isMediaStandalone);
  } catch {
    return false;
  }
}

let cachedContextTime = 0;
let cachedContextObj: TelemetryContext | null = null;

/**
 * Captures current telemetry context snapshot.
 */
export function getTelemetryContext(winOrNav?: Window | Navigator, navParam?: Navigator): TelemetryContext {
  let win: Window | undefined;
  let nav: Navigator | undefined;

  if (winOrNav) {
    if ('userAgent' in winOrNav || 'onLine' in winOrNav) {
      nav = winOrNav as Navigator;
    } else {
      win = winOrNav as Window;
    }
  }
  if (navParam) {
    nav = navParam;
  }

  const isCustom = Boolean(winOrNav || navParam);
  const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
  const isOnline = n ? (typeof n.onLine === 'boolean' ? n.onLine : true) : true;

  const now = Date.now();
  if (!isCustom && cachedContextObj && now - cachedContextTime < 2000 && cachedContextObj.online === isOnline) {
    return cachedContextObj;
  }

  const platform = detectDerivedPlatform(nav);
  const standalone = isStandaloneMode(win);
  const ctx: TelemetryContext = {
    appVersion: APP_VERSION,
    platform,
    displayMode: standalone ? 'standalone' : 'browser',
    online: isOnline,
  };

  if (!isCustom) {
    cachedContextTime = now;
    cachedContextObj = ctx;
  }

  return ctx;
}

/**
 * Deterministic 32-bit FNV-1a hex hash for error type and message.
 */
export function computeErrorHash(type: string, message: string): string {
  const safeType = typeof type === 'string' ? type.trim() : 'Error';
  const safeMessage = typeof message === 'string' ? message.trim() : '';

  let hash = 0x811c9dc5; // 2166136261 (FNV offset basis)
  for (let i = 0; i < safeType.length; i++) {
    hash ^= safeType.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // 16777619 (FNV prime)
  }
  hash ^= 58; // ':' character code
  hash = Math.imul(hash, 0x01000193);
  for (let i = 0; i < safeMessage.length; i++) {
    hash ^= safeMessage.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16);
  return hex.length === 8 ? hex : hex.padStart(8, '0');
}

export const hashError = computeErrorHash;

/**
 * Sanitizes an error object, stripping PII and preparing it for telemetry payload.
 */
export function sanitizeErrorPayload(
  error: unknown,
  options: { source?: string; customMessage?: string; componentStack?: string; preScrubbedMessage?: string } = {}
): SanitizedErrorData {
  let rawType = 'Error';
  let rawMessage = '';
  let rawStack: string | undefined = undefined;

  if (error instanceof Error) {
    rawType = error.name || 'Error';
    rawMessage = error.message || '';
    rawStack = error.stack;
    if (typeof (error as any).issues === 'object' && Array.isArray((error as any).issues)) {
      // ZodError
      const issues = (error as any).issues;
      if (issues.length > 0) {
        rawMessage = issues
          .map((iss: any) => {
            const p = Array.isArray(iss.path) ? iss.path.join('.') : '';
            return `${p ? `${p}: ` : ''}${iss.message || iss.code}`;
          })
          .join('; ');
      }
    }
  } else if (typeof error === 'string') {
    rawMessage = error;
  } else if (typeof error === 'number' || typeof error === 'boolean') {
    rawMessage = String(error);
  } else if (error === null) {
    rawMessage = 'null';
  } else if (error === undefined) {
    rawMessage = 'undefined';
  } else if (typeof error === 'object') {
    try {
      const seen = new WeakSet();
      const safeString = JSON.stringify(error, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        return value;
      });
      const errObj = error as Record<string, any>;
      rawType = String(errObj.name || errObj.type || 'Error');
      rawMessage = errObj.message ? String(errObj.message) : safeString;
      rawStack = typeof errObj.stack === 'string' ? errObj.stack : undefined;
    } catch {
      rawMessage = String(error);
    }
  } else {
    rawMessage = String(error);
  }

  if (options.customMessage) {
    rawMessage = options.customMessage;
  }

  const scrubbedMessage =
    options.preScrubbedMessage !== undefined ? options.preScrubbedMessage : scrubPII(rawMessage);
  const scrubbedStack = rawStack ? truncateStack(rawStack, 1000) : undefined;
  const scrubbedComponentStack = options.componentStack ? truncateStack(options.componentStack, 1000) : undefined;

  const result: SanitizedErrorData = {
    type: rawType,
    message: scrubbedMessage,
    source: options.source || 'custom',
  };

  if (scrubbedStack) {
    result.stack = scrubbedStack;
  }
  if (scrubbedComponentStack) {
    result.componentStack = scrubbedComponentStack;
  }

  return result;
}