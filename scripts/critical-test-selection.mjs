// Keep diagnostic coverage membership stable when test files move into domain folders.
// Dedicated Node/Emulator suites have different environments and are not run by this jsdom runner.
const dedicatedSuites = new Set(['isolated', 'emulator', 'fuzz', 'recovery', 'gc', 'hardening']);
const criticalTestName = /^(?:auth_|authenticated_|account_deletion_|m7_account_deletion_|m7_logout_deletion_|health_consent_|health_data_erasure_|m7_health_|db_sync_|sync_|storage_|browser_storage_|guest_bootstrap_|guest_account_).+\.test\.(?:ts|tsx)$/;

export function isCriticalTest(file) {
  const path = file.replaceAll('\\', '/');
  if (/^src\/(?:lib\/auth|contexts\/auth)\/.*\.test\.(?:ts|tsx)$/.test(path)) return true;
  const segments = path.split('/');
  if (segments[0] !== 'tests' || segments.length < 2 || dedicatedSuites.has(segments[1])) return false;
  return criticalTestName.test(segments.at(-1));
}
