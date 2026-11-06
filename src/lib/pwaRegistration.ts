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
  const updateRef = useRef<ReturnType<typeof registerSW> | null>(null);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;
    const { onNeedRefresh, onOfflineReady, immediate = true, ...rest } = optionsRef.current;
    updateRef.current = registerSW({
      ...rest,
      immediate,
      onNeedRefresh() {
        setNeedRefresh(true);
        onNeedRefresh?.();
      },
      onOfflineReady() {
        setOfflineReady(true);
        onOfflineReady?.();
      },
    });
  }, []);

  const updateServiceWorker = useCallback(async () => {
    await updateRef.current?.();
  }, []);

  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    offlineReady: [offlineReady, setOfflineReady] as const,
    updateServiceWorker,
  };
}
