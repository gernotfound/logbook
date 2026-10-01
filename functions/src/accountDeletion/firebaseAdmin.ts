import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  // Firebase-managed runtimes always expose FIREBASE_CONFIG. In that runtime,
  // force ADC even if a legacy service-account key is accidentally present.
  // The credential fallback below exists only for the temporary Vercel adapter.
  if (optionalEnv('FIREBASE_CONFIG')) {
    return initializeApp();
  }

  const projectId = optionalEnv('FIREBASE_ADMIN_PROJECT_ID');
  const clientEmail = optionalEnv('FIREBASE_ADMIN_CLIENT_EMAIL');
  const privateKey = optionalEnv('FIREBASE_ADMIN_PRIVATE_KEY')?.replace(/\\n/g, '\n');

  if (projectId || clientEmail || privateKey) {
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Configurazione Firebase Admin legacy incompleta.');
    }
    return initializeApp({
      projectId,
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }

  // Cloud Functions for Firebase supplies Application Default Credentials via
  // the runtime service account. No exported long-lived private key is needed.
  return initializeApp();
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export function adminDb() {
  return getFirestore(getAdminApp());
}

export function adminAppCheck() {
  return getAppCheck(getAdminApp());
}
