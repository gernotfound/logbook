// Feature detection per API non supportate su iOS o con comportamento anomalo
export const isBackgroundSyncSupported = 
  'serviceWorker' in navigator && 
  'SyncManager' in window;

export const isPushNotificationSupported = 
  'PushManager' in window;

export async function requestStoragePersistence() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const granted = await navigator.storage.persist();
      return granted;
    } catch (e) {
      console.warn('Storage persistence check failed', e);
      return false;
    }
  }
  return false;
}

export async function openCacheSafe(cacheName: string) {
  try {
    if ('caches' in window) {
      return await caches.open(cacheName);
    }
  } catch (error) {
    console.warn('Cache API failed (possibile limite iOS/Safari):', error);
  }
  return null;
}
