import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useAuth } from '../../hooks/useAuth';
import { auth } from '../../lib/firebase';
import { captureSession, isCurrentSession, type SessionSnapshot } from '../../lib/sync/session';

type Action = 'verify' | 'resend' | 'local';
type GateSession = { user: User | null; session: SessionSnapshot };
type PendingAction = GateSession & { action: Action };
type Feedback = GateSession & { message: string };
type StorageFailure = { user: User | null; message: string };

function isCurrentGateSession({ user, session }: GateSession): boolean {
    return auth.currentUser === user && isCurrentSession(session);
}

export function EmailVerificationGate() {
    const { currentUser, refreshEmailVerification, resendEmailVerification, continueUnverifiedLocally } = useAuth();
    const [pending, setPending] = useState<PendingAction | null>(null);
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [storageFailure, setStorageFailure] = useState<StorageFailure | null>(null);
    // A superseded Auth epoch cannot keep the next account's buttons disabled
    // or expose its feedback, even when the same UID logs in again.
    const busy = pending && isCurrentGateSession(pending) ? pending.action : null;
    const message = feedback && isCurrentGateSession(feedback)
        ? feedback.message
        : storageFailure?.user === auth.currentUser ? storageFailure?.message : null;

    const run = async (action: Action) => {
        if (busy) return;
        let request: GateSession;
        try {
            request = { user: auth.currentUser, session: captureSession() };
        } catch {
            // An unreadable owner/session is not permission to touch Firebase.
            setStorageFailure({
                user: auth.currentUser,
                message: 'Archivio locale non disponibile. Controlla le impostazioni del browser e riprova.',
            });
            return;
        }
        setStorageFailure(null);
        const stillCurrent = () => isCurrentGateSession(request);
        const report = (text: string) => setFeedback({ ...request, message: text });
        setPending({ ...request, action });
        setFeedback(null);
        try {
            if (action === 'verify') {
                const result = await refreshEmailVerification();
                if (!stillCurrent()) return;
                if (result === 'pending') {
                    report('La verifica non risulta ancora completata. Apri il link ricevuto e riprova.');
                } else if (result === 'verified') {
                    report('Email verificata. Apertura dell’account in corso…');
                }
            } else if (action === 'resend') {
                const result = await resendEmailVerification();
                if (!stillCurrent()) return;
                if (result === 'sent') report('Email inviata. Controlla anche la cartella spam.');
                if (result === 'already-verified') report('Email già verificata. Premi “Ho verificato la mia email” per accedere.');
            } else {
                await continueUnverifiedLocally();
            }
        } catch {
            if (stillCurrent()) {
                report(action === 'local'
                    ? 'Non è possibile avviare la modalità locale. I dati già salvati restano conservati: riprova.'
                    : action === 'verify' && request.user?.emailVerified === true
                        ? 'Email verificata, ma l’accesso non è ancora pronto. Le modifiche locali restano conservate: riprova.'
                        : 'Operazione non completata. Controlla la connessione e riprova.');
            }
        } finally {
            if (stillCurrent()) setPending(null);
        }
    };

    return (
        <div id="auth-overlay">
            <section className="ui-login-box-1" aria-labelledby="verify-email-title"
                style={{ width: '90%', maxWidth: '25rem', margin: '0 auto', padding: '1.875rem', textAlign: 'center' }}>
                <h1 id="verify-email-title" className="ui-login-box-2">Verifica la tua email</h1>
                <p className="ui-login-box-3">
                    Per accedere al tuo account e sincronizzare gli allenamenti sul cloud devi prima verificare l'indirizzo email.
                </p>
                <p className="ui-login-box-3">
                    Controlla la casella di {currentUser?.email ?? 'posta elettronica'} e apri il link di verifica. Se non l'hai ricevuto, puoi richiederne uno nuovo.
                </p>
                {message && <p role="status" aria-live="polite">{message}</p>}
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void run('verify')}>
                        {busy === 'verify' ? 'Verifica in corso…' : 'Ho verificato la mia email'}
                    </button>
                    <button type="button" className="btn" disabled={busy !== null} onClick={() => void run('resend')}>
                        {busy === 'resend' ? 'Invio in corso…' : 'Invia di nuovo la verifica'}
                    </button>
                    <button type="button" className="btn" disabled={busy !== null} onClick={() => void run('local')}>
                        {busy === 'local' ? 'Preparazione…' : 'Continua in modalità locale'}
                    </button>
                </div>
                <p className="ui-login-box-3">In modalità locale gli allenamenti rimangono su questo dispositivo; il cloud si attiva dopo la verifica.</p>
            </section>
        </div>
    );
}
