// The warning's count is compared separately; JSON property insertion order
// is not part of its identity in either lint validation or PR guardrails.
export function warningIdentity(item) {
  return JSON.stringify([item.suite, item.file, item.code, item.message, item.source]);
}
