export interface StorageDiagnosticData {
  supported: boolean;
  persistent: boolean;
  usage?: number;
  quota?: number;
}

export async function requestDurableStorage(): Promise<StorageDiagnosticData> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted || !navigator.storage?.persist) {
    return { supported: false, persistent: false };
  }

  try {
    let persistent = await navigator.storage.persisted();
    if (!persistent) persistent = await navigator.storage.persist();

    let estimate: StorageEstimate | undefined;
    try {
      estimate = await navigator.storage.estimate?.();
    } catch (error) {
      // A quota estimate failure must not revoke an already confirmed durability grant.
      console.warn('Stima spazio archiviazione non disponibile:', error);
    }

    return { supported: true, persistent, usage: estimate?.usage, quota: estimate?.quota };
  } catch (error) {
    console.error('Errore durante la richiesta di storage persistente:', error);
    return { supported: true, persistent: false };
  }
}

let storageDiagnosticData: StorageDiagnosticData | null = null;
const listeners = new Set<() => void>();

export function subscribeStorageDiagnosticData(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setStorageDiagnosticData(data: StorageDiagnosticData | null): void {
  storageDiagnosticData = data;
  for (const listener of listeners) listener();
}

export function getStorageDiagnosticData(): StorageDiagnosticData | null {
  return storageDiagnosticData;
}
