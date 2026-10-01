export type FirebaseAnalyticsSdk = typeof import('firebase/analytics');

export function importFirebaseAnalyticsSdk(): Promise<FirebaseAnalyticsSdk> {
    return import('firebase/analytics');
}
