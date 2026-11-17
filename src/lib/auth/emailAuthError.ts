import { PASSWORD_POLICY_SUMMARY } from './passwordPolicy';

export function describeEmailAuthError(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code : undefined;
    const localPolicyFeedback = error && typeof error === 'object' && 'policyFeedback' in error
        ? (error as { policyFeedback?: unknown }).policyFeedback : null;
    switch (code) {
        case 'auth/email-already-in-use': return 'Registrazione non completata. Controlla i dati oppure prova ad accedere o recuperare la password.';
        case 'auth/invalid-email': return 'Formato email non valido.';
        case 'auth/weak-password': return typeof localPolicyFeedback === 'string' && localPolicyFeedback.length > 0
            ? localPolicyFeedback : PASSWORD_POLICY_SUMMARY;
        case 'auth/password-policy-unavailable': return 'Non è possibile verificare i requisiti password con Firebase. Controlla la connessione e riprova.';
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential': return 'Email o password errati.';
        case 'auth/too-many-requests': return 'Troppi tentativi. Riprova più tardi.';
        case 'auth/network-request-failed': return 'Connessione non disponibile. Controlla la rete e riprova.';
        case 'auth/operation-not-allowed': return 'Registrazione tramite email temporaneamente non disponibile.';
        default: return 'Operazione non riuscita. Riprova tra poco.';
    }
}
