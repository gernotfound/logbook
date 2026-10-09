/** Production launch is intentionally unavailable until a reviewed legal release. */
export function healthConsentLaunchAvailable(): boolean {
  return import.meta.env.MODE === 'test' || import.meta.env.MODE === 'health-e2e';
}
