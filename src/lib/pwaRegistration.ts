import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import type { RegisterSWOptions } from 'virtual:pwa-register';

/**
 * The plugin's React virtual module can initialize a different React dispatcher
 * with the application's manually split vendor chunks. Register through its
 * framework-independent entry and keep React state in the application bundle.
 */
export function useRegisterSW(options: RegisterSWOptions = {}) {
  const optionsRef = useRef(options);
  const registered = useRef(false);
  const mounted = useRef(false);
  const updateRef = useRef<ReturnType<typeof registerSW> | null>(null);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    mounted.current = true;
    // StrictMode replays effects without recreating the hook. Restore callback
    // delivery on that replay, but never register a second Workbox instance.
    if (!registered.current) {
      registered.current = true;
      const {
        onNeedReload, onNeedRefresh, onOfflineReady, onRegisteredSW, onRegisterError,
        immediate = true, ...rest
      } = optionsRef.current;
      updateRef.current = registerSW({
        ...rest,
        immediate,
        // Always override Workbox's automatic navigation, even after unmount.
        // The consumer owns the explicit persistence barrier and reload.
        onNeedReload() {
          if (mounted.current) onNeedReload?.();
        },
        onNeedRefresh() {
          if (!mounted.current) return;
          setNeedRefresh(true);
          onNeedRefresh?.();
        },
        onOfflineReady() {
          if (!mounted.current) return;
          setOfflineReady(true);
          onOfflineReady?.();
        },
        onRegisteredSW(scriptUrl, registration) {
          if (mounted.current) onRegisteredSW?.(scriptUrl, registration);
        },
        onRegisterError(error) {
          if (mounted.current) onRegisterError?.(error);
        },
      });
    }
    // Workbox can finish registering after React removes the prompt. Do not let
    // that late callback recreate the consumer's already-cleaned update timer.
    return () => { mounted.current = false; };
  }, []);

  const updateServiceWorker = useCallback(async () => {
    if (mounted.current) await updateRef.current?.();
  }, []);

  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    offlineReady: [offlineReady, setOfflineReady] as const,
    updateServiceWorker,
  };
}
