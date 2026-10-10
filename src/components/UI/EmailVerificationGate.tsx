import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

type Action = 'verify' | 'resend' | 'local';

export function EmailVerificationGate() {
    const { currentUser, refreshEmailVerification, resendEmailVerification, continueUnverifiedLocally } = useAuth();
    const [busy, setBusy] = useState<Action | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const run = async (action: Action) => {
        if (busy) return;
        setBusy(action);
        setMessage(null);
        try {
            if (action === 'verify') {
                await refreshEmailVerification();
                setMessage('La verifica non risulta ancora completata. Apri il link ricevuto e riprova.');
            } else if (action === 'resend') {
                await resendEmailVerification();
                setMessage('Email inviata. Controlla anche la cartella spam.');
            } else {
                await continueUnverifiedLocally();
            }
        } catch {
            setMessage(action === 'local'
                ? 'Non è possibile avviare la modalità locale. I dati già salvati restano conservati: riprova.'
                : 'Operazione non completata. Controlla la connessione e riprova.');
        } finally {
            setBusy(null);
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
                {message && <p role="status" aria-live="polite">{message}</p>}
            </section>
        </div>
    );
}
