import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing server environment variable: ${name}`);
  return value.trim();
}

function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = requiredEnv('FIREBASE_ADMIN_PROJECT_ID');
  const clientEmail = requiredEnv('FIREBASE_ADMIN_CLIENT_EMAIL');
  const privateKey = requiredEnv('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n');

  return initializeApp({
    projectId,
    credential: cert({ projectId, clientEmail, privateKey }),
  });
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

/** OAuth cloud-platform token from the SAME trusted Admin credential; never expose to clients. */
export async function adminGoogleCloudAccessToken(): Promise<string> {
  const credential = getAdminApp().options.credential;
  if (!credential) throw new Error('Credenziale server Google Cloud non configurata.');
  const token = await credential.getAccessToken();
  if (!token.access_token) throw new Error('Token Google Cloud non disponibile.');
  return token.access_token;
}
