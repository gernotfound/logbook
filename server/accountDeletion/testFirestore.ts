import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import {
  assertTestOidcEnvironment,
  createTestOidcCredential,
  TEST_FIREBASE_PROJECT_ID,
} from './testOidcCredential.js';

/**
 * Firebase Admin Firestore supports certificate or ADC credentials, but not
 * custom Admin Credential implementations. Only the isolated Test backend
 * passes short-lived, keyless WIF tokens to the Firestore Google-GAX client.
 * Production continues to use getFirestore(app).
 */
export function createTestFirestore(): Firestore {
  assertTestOidcEnvironment(process.env);
  const credential = createTestOidcCredential();
  const authClient = new OAuth2Client();

  authClient.eagerRefreshThresholdMillis = 60_000;
  authClient.refreshHandler = async () => {
    const token = await credential.getAccessToken();
    return {
      access_token: token.access_token,
      expiry_date: Date.now() + token.expires_in * 1000,
      token_type: 'Bearer',
    };
  };

  // Firestore serializes settings in diagnostics: never serialize bearer tokens.
  Object.defineProperty(authClient, 'toJSON', {
    value: () => ({ type: 'test-oidc-auth-client' }),
    enumerable: false,
  });

  // GoogleAuthOptions.authClient is supported by GAX but omitted from the
  // Firestore.Settings type. This exact SDK integration is regression-tested.
  const settings = { projectId: TEST_FIREBASE_PROJECT_ID, authClient };
  return new Firestore(settings as ConstructorParameters<typeof Firestore>[0]);
}
