import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountDeletionApiUrl, publicOrigin } from '../src/lib/deploymentConfig';

const validDeletionUrl =
  'https://europe-west1-test-project-id.cloudfunctions.net/accountDeletion';

describe('deployment configuration', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project-id');
    vi.stubEnv('VITE_FIREBASE_FUNCTION_REGION', 'europe-west1');
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_URL', validDeletionUrl);
    vi.stubEnv('VITE_PUBLIC_ORIGIN', 'https://test-domain.web.app');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses only the direct accountDeletion Function for the configured project', () => {
    expect(accountDeletionApiUrl()).toBe(validDeletionUrl);
  });

  it('fails closed when the account deletion endpoint is missing', () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_URL', '');

    expect(() => accountDeletionApiUrl()).toThrow(
      'VITE_ACCOUNT_DELETION_API_URL mancante',
    );
  });
  it('rejects a Cloud Functions endpoint from a different configured region', () => {
    vi.stubEnv(
      'VITE_ACCOUNT_DELETION_API_URL',
      'https://us-central1-test-project-id.cloudfunctions.net/accountDeletion',
    );
    expect(() => accountDeletionApiUrl()).toThrow(
      'deve puntare alla Function accountDeletion del progetto Firebase configurato',
    );
  });

  it('fails closed when the configured Function region is missing', () => {
    vi.stubEnv('VITE_FIREBASE_FUNCTION_REGION', '');
    expect(() => accountDeletionApiUrl()).toThrow('VITE_FIREBASE_FUNCTION_REGION mancante');
  });

  it('rejects a Cloud Functions endpoint for a different Firebase project', () => {
    vi.stubEnv(
      'VITE_ACCOUNT_DELETION_API_URL',
      'https://europe-west1-other-project.cloudfunctions.net/accountDeletion',
    );

    expect(() => accountDeletionApiUrl()).toThrow(
      'deve puntare alla Function accountDeletion del progetto Firebase configurato',
    );
  });

  it('rejects a different function path or URL decorations', () => {
    vi.stubEnv(
      'VITE_ACCOUNT_DELETION_API_URL',
      'https://europe-west1-test-project-id.cloudfunctions.net/other?x=1',
    );

    expect(() => accountDeletionApiUrl()).toThrow(
      'deve puntare alla Function accountDeletion del progetto Firebase configurato',
    );
  });

  it('rejects non-HTTPS account deletion endpoints', () => {
    vi.stubEnv(
      'VITE_ACCOUNT_DELETION_API_URL',
      'http://europe-west1-test-project-id.cloudfunctions.net/accountDeletion',
    );

    expect(() => accountDeletionApiUrl()).toThrow('deve usare HTTPS');
  });
  it('keeps the public origin validation independent from the Function endpoint', () => {
    expect(publicOrigin()).toBe('https://test-domain.web.app');

    vi.stubEnv('VITE_PUBLIC_ORIGIN', 'http://test-domain.web.app');
    expect(() => publicOrigin()).toThrow('VITE_PUBLIC_ORIGIN deve usare HTTPS');
  });
});
