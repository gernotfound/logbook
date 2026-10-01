import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  // Cloud Functions for Firebase authenticates with the configured runtime
  // service account through Application Default Credentials. No exported
  // service-account private key is accepted by this runtime.
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
