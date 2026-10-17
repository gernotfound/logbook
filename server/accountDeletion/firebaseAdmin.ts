import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createTestFirestore } from './testFirestore.js';
import { assertTestOidcEnvironment, createTestOidcCredential, TEST_FIREBASE_PROJECT_ID } from './testOidcCredential.js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing server environment variable: ${name}`);
  return value.trim();
}

function getAdminApp(): App {
  const projectId = requiredEnv('FIREBASE_ADMIN_PROJECT_ID');
  const mode = process.env.FIREBASE_ADMIN_AUTH_MODE;

  // The test project MUST NOT fall back to the Production-style private key.
  if (mode === 'vercel-oidc' || projectId === TEST_FIREBASE_PROJECT_ID) {
    assertTestOidcEnvironment(process.env);
  } else if (mode !== undefined && mode !== '') {
    throw new Error('Unsupported Firebase Admin authentication mode.');
  }

  const existing = getApps()[0];
  if (existing) {
    if (existing.options.projectId !== projectId) throw new Error('Firebase Admin project mismatch.');
    return existing;
  }

  if (mode === 'vercel-oidc') {
    return initializeApp({ projectId, credential: createTestOidcCredential() });
  }

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

let isolatedTestDb: Firestore | undefined;

export function adminDb() {
  const app = getAdminApp();
  if (process.env.FIREBASE_ADMIN_AUTH_MODE === 'vercel-oidc') {
    // Admin Firestore rejects custom Admin credentials. Reuse the isolated
    // Test Firestore client with a Google-GAX OAuth client backed by WIF.
    isolatedTestDb ??= createTestFirestore();
    return isolatedTestDb;
  }
  return getFirestore(app);
}

export function adminAppCheck() {
  return getAppCheck(getAdminApp());
}
