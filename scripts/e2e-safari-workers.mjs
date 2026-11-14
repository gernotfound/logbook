// Keep Chromium unchanged. WebKit layout journeys are substantially longer,
// so a third process can run a further isolated browser context concurrently.
// This changes scheduling only, not shard assignment, retries or assertions.
export function withSafariCIWorkers(args, isCI) {
  const index = args.findIndex(arg => arg === '--project');
  const safari = args.includes('--project=mobile-safari') || (index !== -1 && args[index + 1] === 'mobile-safari');
  if (!isCI || !safari) return [...args];
  if (args.some(arg => arg === '--workers' || arg.startsWith('--workers='))) return [...args];
  return [...args, '--workers=3'];
}
