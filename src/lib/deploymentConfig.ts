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
  const configured = absoluteHttpsUrl(import.meta.env.VITE_ACCOUNT_DELETION_API_URL, 'VITE_ACCOUNT_DELETION_API_URL');
  if (configured) return configured;
  if (import.meta.env.PROD) {
    throw new Error('Configurazione Production incompleta: VITE_ACCOUNT_DELETION_API_URL mancante.');
  }
  return '/api/account-deletion';
}

export function publicOrigin(): string | undefined {
  return absoluteHttpsUrl(import.meta.env.VITE_PUBLIC_ORIGIN, 'VITE_PUBLIC_ORIGIN');
}

export function originMigrationSource(): string | undefined {
  return absoluteHttpsUrl(import.meta.env.VITE_ORIGIN_MIGRATION_SOURCE, 'VITE_ORIGIN_MIGRATION_SOURCE');
}

export function originMigrationTarget(): string | undefined {
  return absoluteHttpsUrl(import.meta.env.VITE_ORIGIN_MIGRATION_TARGET, 'VITE_ORIGIN_MIGRATION_TARGET');
}
