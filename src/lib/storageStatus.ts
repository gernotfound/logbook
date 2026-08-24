export async function requestDurableStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted || !navigator.storage?.persist) {
    return { supported: false, persistent: false };
  }

  try {
    let persistent = await navigator.storage.persisted();

    if (!persistent) {
      persistent = await navigator.storage.persist();
    }

    const estimate = navigator.storage.estimate
      ? await navigator.storage.estimate()
      : undefined;

    return {
      supported: true,
      persistent,
      usage: estimate?.usage,
      quota: estimate?.quota,
    };
  } catch (e) {
    console.error("Errore durante la richiesta di storage persistente:", e);
    return { supported: true, persistent: false };
  }
}

let storageDiagnosticData: any = null;

export const setStorageDiagnosticData = (data: any) => {
  storageDiagnosticData = data;
};

export const getStorageDiagnosticData = () => {
  return storageDiagnosticData;
};
