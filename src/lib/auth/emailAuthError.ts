import { PASSWORD_POLICY_SUMMARY } from './passwordPolicy';

export function describeEmailAuthError(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code : undefined;
    switch (code) {
        case 'auth/email-already-in-use': return 'Questa email è già registrata. Prova ad accedere o recupera la password.';
        case 'auth/invalid-email': return 'Formato email non valido.';
        case 'auth/weak-password': return PASSWORD_POLICY_SUMMARY;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential': return 'Email o password errati.';
        case 'auth/too-many-requests': return 'Troppi tentativi. Riprova più tardi.';
        case 'auth/network-request-failed': return 'Connessione non disponibile. Controlla la rete e riprova.';
        case 'auth/operation-not-allowed': return 'Registrazione tramite email temporaneamente non disponibile.';
        default: return 'Operazione non riuscita. Riprova tra poco.';
    }
}
