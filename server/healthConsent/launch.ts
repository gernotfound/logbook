/**
 * Fail-closed trusted release gate shared by the endpoint and daily cron.
 * Turning on irreversible erasure requires a new reviewed code change,
 * never a runtime environment variable or a Preview build.
 */
export function healthConsentReleaseEnabled(): boolean {
  return false;
}
