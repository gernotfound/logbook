// Vitest reads Vite's effective environment after shell and .env.*.local
// precedence. Fail before mounting any test if a local override could point
// Firebase or a future VITE_* transport at a real external service.
export const SYNTHETIC_FIREBASE_TEST_ENV = Object.freeze({
    VITE_FIREBASE_API_KEY: 'test-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'test-domain.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'test-project-id',
    VITE_FIREBASE_APP_ID: '1:123456789:web:testappid',
});

export const TEST_BACKEND_ORIGIN = 'http://127.0.0.1:9';
const allowedKeys = new Set([...Object.keys(SYNTHETIC_FIREBASE_TEST_ENV), 'VITE_ACCOUNT_DELETION_API_ORIGIN']);

export function assertIsolatedVitestEnvironment(effective: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(SYNTHETIC_FIREBASE_TEST_ENV)) {
        if (effective[key] !== value) {
            throw new Error('Configurazione test non isolata: ' + key + ' deve usare il placeholder sintetico di .env.test.');
        }
    }
    for (const [key, value] of Object.entries(effective)) {
        if (!key.startsWith('VITE_')) continue;
        if (!allowedKeys.has(key)) {
            throw new Error('Configurazione test non isolata: variabile client non prevista ' + key + '.');
        }
        if (key === 'VITE_ACCOUNT_DELETION_API_ORIGIN' && value !== TEST_BACKEND_ORIGIN) {
            throw new Error('Configurazione test non isolata: backend trusted deve usare il loopback non servito.');
        }
    }
}
