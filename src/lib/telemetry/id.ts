let fallbackSequence = 0;

function randomSuffix(): string | null {
  const webCrypto = globalThis.crypto;
  if (!webCrypto) return null;

  if (typeof webCrypto.randomUUID === 'function') {
    try {
      return webCrypto.randomUUID().replaceAll('-', '');
    } catch {
      // Telemetry identifiers are best-effort; try the lower-level Web Crypto API.
    }
  }

  if (typeof webCrypto.getRandomValues === 'function') {
    try {
      const bytes = webCrypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to the monotonic runtime-local suffix below.
    }
  }

  return null;
}

/**
 * Telemetry identifiers preserve the historical prefix/timestamp/suffix shape
 * while replacing Math.random entropy with Web Crypto whenever available.
 * The monotonic fallback is deliberately non-security-sensitive: it prevents
 * same-runtime collisions without making telemetry a hard app gate.
 */
export function createTelemetryId(prefix: string, timestamp: number = Date.now()): string {
  const suffix = randomSuffix();
  if (suffix) return `${prefix}_${timestamp}_${suffix}`;

  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}_${timestamp}_${fallbackSequence.toString(36)}`;
}
