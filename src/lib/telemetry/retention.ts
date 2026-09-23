export const TELEMETRY_RETENTION_DAYS = 30;
export const TELEMETRY_RETENTION_MS = TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function telemetryExpiresAt(anchorMs: number): Date {
  if (!Number.isFinite(anchorMs)) {
    throw new Error('Telemetry retention anchor must be finite');
  }

  const expiresAtMs = anchorMs + TELEMETRY_RETENTION_MS;
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error('Telemetry retention expiry is outside the supported range');
  }

  return new Date(expiresAtMs);
}
