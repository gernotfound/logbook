export type BackgroundPreloadTask = () => Promise<unknown>;

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike;
};

export interface BackgroundPreloadOptions {
  initialDelayMs?: number;
  fallbackIdleDelayMs?: number;
  isConstrainedNetwork?: () => boolean;
}

const DEFAULT_INITIAL_DELAY_MS = 1500;
const DEFAULT_FALLBACK_IDLE_DELAY_MS = 700;

function isBackgroundPreloadConstrained(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as NavigatorWithConnection).connection;
  return connection?.saveData === true
    || connection?.effectiveType === 'slow-2g'
    || connection?.effectiveType === '2g';
}

/**
 * Preloads one module at a time only while the app is visible and idle.
 * The tasks should import code only: they must not mount views or start view hooks.
 */
export function scheduleSequentialIdlePreload(
  tasks: readonly BackgroundPreloadTask[],
  options: BackgroundPreloadOptions = {},
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || tasks.length === 0) {
    return () => undefined;
  }

  const isConstrainedNetwork = options.isConstrainedNetwork ?? isBackgroundPreloadConstrained;
  if (isConstrainedNetwork()) return () => undefined;

  const queue = [...tasks];
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const fallbackIdleDelayMs = options.fallbackIdleDelayMs ?? DEFAULT_FALLBACK_IDLE_DELAY_MS;

  let cancelled = false;
  let running = false;
  let timeoutHandle: number | null = null;
  let idleHandle: number | null = null;

  const clearScheduled = () => {
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleHandle);
      idleHandle = null;
    }
  };

  const canRun = () => (
    !cancelled
    && document.visibilityState === 'visible'
    && !isConstrainedNetwork()
  );

  const scheduleNext = () => {
    if (!canRun() || running || queue.length === 0 || timeoutHandle !== null || idleHandle !== null) return;

    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => {
        idleHandle = null;
        void runNext();
      });
      return;
    }

    timeoutHandle = window.setTimeout(() => {
      timeoutHandle = null;
      void runNext();
    }, fallbackIdleDelayMs);
  };

  const runNext = async () => {
    if (!canRun()) return;
    const task = queue.shift();
    if (!task) return;

    running = true;
    try {
      await task();
    } catch {
      // Best-effort warm-up only. Normal lazy navigation remains the recovery path.
    } finally {
      running = false;
    }

    if (canRun()) scheduleNext();
  };

  const handleVisibilityChange = () => {
    if (cancelled) return;
    if (document.visibilityState !== 'visible') {
      clearScheduled();
      return;
    }
    scheduleNext();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  timeoutHandle = window.setTimeout(() => {
    timeoutHandle = null;
    scheduleNext();
  }, initialDelayMs);

  return () => {
    cancelled = true;
    clearScheduled();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
