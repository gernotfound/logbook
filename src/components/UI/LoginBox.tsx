import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { sendPasswordResetEmail, auth } from '../../lib/firebase';
import { useDialogStore } from '../../store/useDialogStore';

export const LoginBox = () => {
    const { login, loginWithEmail, registerWithEmail, loginAsGuest } = useAuth();
    const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [resetSent, setResetSent] = useState(false);

    const { showAlert } = useDialogStore();

    const checkPasswordStrength = (pass: string) => {
        if (pass.length < 8) return 'La password deve contenere almeno 8 caratteri.';
        if (!/\d/.test(pass)) return 'La password deve contenere almeno 1 numero.';
        if (!/[a-z]/.test(pass)) return 'La password deve contenere almeno 1 lettera minuscola.';
        if (!/[A-Z]/.test(pass)) return 'La password deve contenere almeno 1 lettera maiuscola.';
        if (!/[!@#$%^&*(),.?":{}|<>_+-]/.test(pass)) return 'La password deve contenere almeno 1 carattere speciale.';
        return null;
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setLoading(true);
        try {
            if (mode === 'login') {
                await loginWithEmail(email, password);
            } else if (mode === 'register') {
                if (password !== confirmPassword) {
                    await showAlert('Le password non coincidono.');
                    setLoading(false);
                    return;
                }
                const weakError = checkPasswordStrength(password);
                if (weakError) {
                    await showAlert(weakError);
                    setLoading(false);
                    return;
                }
                await registerWithEmail(email, password);
            } else {
                if (!email) {
                    await showAlert('Inserisci la tua email.');
                    setLoading(false);
                    return;
                }
                await sendPasswordResetEmail(auth, email);
                setResetSent(true);
                await showAlert("Se l'email è registrata, riceverai un link per reimpostare la password. Controlla anche la cartella spam.");
                setTimeout(() => setResetSent(false), 60000);
                setMode('login');
            }
        } catch (error: any) {
            if (mode === 'forgot') {
                if (error.code === 'auth/invalid-email') {
                    await showAlert('Formato email non valido.');
                } else if (error.code === 'auth/too-many-requests') {
                    await showAlert('Troppi tentativi. Riprova più tardi.');
                } else {
                    await showAlert("Errore durante l'invio dell'email.");
                }
            }
        } finally {
            setLoading(false);
        }
    };

    const switchMode = (nextMode: 'login' | 'register') => {
        setMode(nextMode);
        setPassword('');
        setConfirmPassword('');
    };

    return (
        <div id="auth-login-box" className="auth-card">
            <div className="auth-brand">
                <span className="auth-brand__mark">Training companion</span>
                <h1>LogBook</h1>
                <p>Allenamenti, nutrizione e progressi. I tuoi dati restano disponibili anche offline.</p>
            </div>

            <div className="auth-mode-switch" role="tablist" aria-label="Modalità accesso">
                <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'login' || mode === 'forgot'}
                    className={`btn ${mode === 'login' || mode === 'forgot' ? 'active' : ''}`}
                    onClick={() => switchMode('login')}
                >
                    Accedi
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'register'}
                    className={`btn ${mode === 'register' ? 'active' : ''}`}
                    onClick={() => switchMode('register')}
                >
                    Registrati
                </button>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
                <input
                    type="email"
                    placeholder="La tua email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                />

                {mode !== 'forgot' && (
                    <div className="auth-password-field">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            placeholder={mode === 'register' ? 'Password (min 8 caratteri)' : 'Password'}
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            required
                            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                        />
                        <button
                            type="button"
                            className="auth-password-toggle"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                        >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                )}

                {mode === 'register' && (
                    <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Conferma password"
                        value={confirmPassword}
                        onChange={event => setConfirmPassword(event.target.value)}
                        required
                        autoComplete="new-password"
                    />
                )}

                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading || (mode === 'forgot' && resetSent)}
                >
                    {loading ? 'Attendi...' : (mode === 'login' ? 'Accedi' : mode === 'register' ? 'Registrati' : 'Invia link di recupero')}
                </button>

                {mode === 'login' && (
                    <button type="button" className="auth-link" onClick={() => setMode('forgot')}>
                        Hai dimenticato la password?
                    </button>
                )}
                {mode === 'forgot' && (
                    <button type="button" className="auth-link auth-link--muted" onClick={() => setMode('login')}>
                        Torna all'accesso
                    </button>
                )}

                <div className="auth-separator"><span>oppure</span></div>

                <button id="btn-login-google" type="button" className="btn auth-google" onClick={login}>
                    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 0 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Accedi con Google
                </button>

                <button
                    id="btn-login-anonymous"
                    type="button"
                    className="btn auth-guest"
                    onClick={loginAsGuest}
                >
                    Continua senza account
                </button>
                <p className="auth-footnote">I dati saranno salvati solo sul dispositivo.</p>
            </form>
        </div>
    );
};
