function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function absoluteHttpsUrl(value: string | undefined, name: string): string | undefined {
  const raw = trimmed(value);
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Configurazione non valida: ${name} deve essere un URL assoluto.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Configurazione non valida: ${name} deve usare HTTPS.`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function accountDeletionApiUrl(): string {
  const configured = absoluteHttpsUrl(
    import.meta.env.VITE_ACCOUNT_DELETION_API_URL,
    'VITE_ACCOUNT_DELETION_API_URL',
  );
  if (!configured) {
    throw new Error('Configurazione incompleta: VITE_ACCOUNT_DELETION_API_URL mancante.');
  }

  const projectId = trimmed(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  if (!projectId) {
    throw new Error('Configurazione incompleta: VITE_FIREBASE_PROJECT_ID mancante.');
  }
  const functionRegion = trimmed(import.meta.env.VITE_FIREBASE_FUNCTION_REGION);
  if (!functionRegion) {
    throw new Error('Configurazione incompleta: VITE_FIREBASE_FUNCTION_REGION mancante.');
  }

  const parsed = new URL(configured);
  const expectedHost = `${functionRegion}-${projectId}.cloudfunctions.net`;
  if (
    parsed.hostname !== expectedHost
    || parsed.pathname !== '/accountDeletion'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(
      'Configurazione non valida: VITE_ACCOUNT_DELETION_API_URL deve puntare alla Function accountDeletion del progetto Firebase configurato.',
    );
  }

  return parsed.origin + '/accountDeletion';
}

export function publicOrigin(): string | undefined {
  return absoluteHttpsUrl(import.meta.env.VITE_PUBLIC_ORIGIN, 'VITE_PUBLIC_ORIGIN');
}
