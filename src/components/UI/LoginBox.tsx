import React, { useId, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { sendPasswordResetEmail, auth } from '../../lib/firebase';
import { useDialogStore } from '../../store/useDialogStore';
import { writeBrowserValue } from '../../lib/sync/browserStorage';
import { Eye, EyeOff } from 'lucide-react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';

interface LoginBoxProps {
    onCancel?: () => void;
}

export const LoginBox: React.FC<LoginBoxProps> = ({ onCancel }) => {
    const { login, loginWithEmail, registerWithEmail, loginAsGuest, linkGoogleAccount, isGuest } = useAuth();
    const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [resetSent, setResetSent] = useState(false);
    const [migrationPolicy, setMigrationPolicy] = useState<'merge' | 'skip'>('merge');
    const { showAlert, isOpen: globalDialogOpen } = useDialogStore();
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const emailInputRef = useRef<HTMLInputElement>(null);
    useModalFocusTrap({
        containerRef: dialogRef,
        initialFocusRef: emailInputRef,
        active: Boolean(onCancel) && !globalDialogOpen,
        onEscape: onCancel,
    });

    const checkPasswordStrength = (pass: string) => {
        if (pass.length < 8) return "La password deve contenere almeno 8 caratteri.";
        if (!/\d/.test(pass)) return "La password deve contenere almeno 1 numero.";
        if (!/[a-z]/.test(pass)) return "La password deve contenere almeno 1 lettera minuscola.";
        if (!/[A-Z]/.test(pass)) return "La password deve contenere almeno 1 lettera maiuscola.";
        if (!/[!@#$%^&*(),.?":{}|<>_+-]/.test(pass)) return "La password deve contenere almeno 1 carattere speciale.";
        return null; // OK
    };

    const handleAuthAction = async (action: () => Promise<void>) => {
        if (isGuest) {
            try {
                writeBrowserValue('guest_migration_policy', migrationPolicy);
            } catch {
                await showAlert('Impossibile salvare la scelta di trasferimento sul dispositivo. Libera spazio o abilita l’archivio del browser e riprova.');
                return;
            }
        }
        await action();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (mode === 'login') {
                await handleAuthAction(() => loginWithEmail(email, password));
            } else if (mode === 'register') {
                if (password !== confirmPassword) {
                    await showAlert("Le password non coincidono.");
                    setLoading(false);
                    return;
                }
                const weakError = checkPasswordStrength(password);
                if (weakError) {
                    await showAlert(weakError);
                    setLoading(false);
                    return;
                }
                await handleAuthAction(() => registerWithEmail(email, password));
            } else if (mode === 'forgot') {
                if (!email) {
                    await showAlert("Inserisci la tua email.");
                    setLoading(false);
                    return;
                }
                await sendPasswordResetEmail(auth, email);
                setResetSent(true);
                await showAlert("Se l'email è registrata, riceverai un link per reimpostare la password. Controlla anche la cartella spam.");
                setTimeout(() => setResetSent(false), 60000); // 60s timeout
                setMode('login');
            }
        } catch (error: any) {
            if (mode === 'forgot') {
                if (error.code === 'auth/invalid-email') {
                    await showAlert("Formato email non valido.");
                } else if (error.code === 'auth/too-many-requests') {
                    await showAlert("Troppi tentativi. Riprova più tardi.");
                } else {
                    await showAlert("Errore durante l'invio dell'email.");
                }
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div id="auth-login-box" ref={dialogRef} role={onCancel ? "dialog" : undefined} aria-modal={onCancel ? "true" : undefined} aria-labelledby={onCancel ? titleId : undefined} tabIndex={onCancel ? -1 : undefined} className="ui-login-box-1" style={{ textAlign: "center", width: "90%", maxWidth: "25rem", margin: "0 auto", padding: "1.875rem", overflowY: "auto", maxHeight: "100vh" }}>
            <h1 id={titleId} className="ui-login-box-2" style={{ marginBottom: "0.625rem" }}>LogBook</h1>
            <p className="ui-login-box-3" style={{ marginBottom: "1.25rem" }}>
                Accedi o registrati per sincronizzare i tuoi allenamenti sul cloud.
            </p>

            <div style={{ display: "flex", gap: "0.625rem", marginBottom: "1.25rem" }}>
                <button
                    type="button"
                    className={`btn ${mode === 'login' || mode === 'forgot' ? 'btn-primary' : ''}`}
                    style={{ flex: 1, margin: 0, padding: "0.625rem", background: (mode === "login" || mode === "forgot") ? "" : "var(--surface-light)", color: (mode === "login" || mode === "forgot") ? "" : "var(--text-muted)", border: (mode === "login" || mode === "forgot") ? "" : "1px solid var(--glass-border)" }}
                    onClick={() => { setMode('login'); setPassword(''); setConfirmPassword(''); }}
                >
                    Accedi
                </button>
                <button
                    type="button"
                    className={`btn ${mode === 'register' ? 'btn-primary' : ''}`}
                    style={{ flex: 1, margin: 0, padding: "0.625rem", background: mode === "register" ? "" : "var(--surface-light)", color: mode === "register" ? "" : "var(--text-muted)", border: mode === "register" ? "" : "1px solid var(--glass-border)" }}
                    onClick={() => { setMode('register'); setPassword(''); setConfirmPassword(''); }}
                >
                    Registrati
                </button>
            </div>

            {isGuest && mode !== 'forgot' && (
                <div className="ui-login-box-4" style={{ marginBottom: "1.25rem", textAlign: "left", padding: "0.9375rem" }}>
                    <p className="ui-login-box-5" style={{ marginBottom: "0.625rem" }}>Hai dei dati salvati in locale. Cosa vuoi fare?</p>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.625rem", cursor: "pointer" }}>
                        <input type="radio" name="migration_policy" value="merge" checked={migrationPolicy === 'merge'} onChange={() => setMigrationPolicy('merge')} />
                        <span className="ui-login-box-6" >Trasferisci i progressi nell'account</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.625rem", cursor: "pointer" }}>
                        <input type="radio" name="migration_policy" value="skip" checked={migrationPolicy === 'skip'} onChange={() => setMigrationPolicy('skip')} />
                        <span className="ui-login-box-7" >Non trasferire i progressi</span>
                    </label>
                </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.9375rem" }}>
                <input
                    ref={emailInputRef}
                    type="email"
                    aria-label="Email"
                    placeholder="La tua email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="ui-login-box-8" style={{ padding: "0.75rem" }}
                />

                {mode !== 'forgot' && (
                    <div style={{ position: "relative" }}>
                        <input
                            type={showPassword ? "text" : "password"}
                            aria-label="Password"
                            placeholder={mode === 'register' ? 'Password (min 8 car, A-a, num, spec)' : 'Password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                            className="ui-login-box-9" style={{ padding: "0.75rem", paddingRight: "2.5rem", width: "100%", boxSizing: "border-box" }}
                        />
                        <button
                            type="button"
                            aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                            onClick={() => setShowPassword(!showPassword)}
                            className="ui-login-box-10" style={{ position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)", cursor: "pointer", display: "flex", alignItems: "center" }}
                        >
                            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                        </button>
                    </div>
                )}

                {mode === 'register' && (
                    <input
                        type={showPassword ? "text" : "password"}
                        aria-label="Conferma password"
                        placeholder="Conferma Password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        className="ui-login-box-11" style={{ padding: "0.75rem", width: "100%", boxSizing: "border-box" }}
                    />
                )}

                <button
                    type="submit"
                    className="btn btn-primary ui-login-box-12"
                    style={{ padding: "0.9375rem", marginTop: "0.3125rem" }}
                    disabled={loading || (mode === 'forgot' && resetSent)}
                >
                    {loading ? 'Attendi...' : (mode === 'login' ? 'Accedi' : mode === 'register' ? 'Registrati' : 'Invia Link di Recupero')}
                </button>

                {mode === 'login' && (
                    <button type="button" onClick={() => setMode('forgot')} className="ui-login-box-13" style={{ cursor: "pointer", textDecoration: "underline" }}>
                        Hai dimenticato la password?
                    </button>
                )}
                {mode === 'forgot' && (
                    <button type="button" onClick={() => setMode('login')} className="ui-login-box-14" style={{ cursor: "pointer" }}>
                        Torna all'accesso
                    </button>
                )}
            </form>

            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", margin: "1.25rem 0" }}>
                <div className="ui-login-box-15" style={{ flex: 1, height: "1px" }} />
                <span className="ui-login-box-16" style={{ whiteSpace: "nowrap" }}>oppure</span>
                <div className="ui-login-box-17" style={{ flex: 1, height: "1px" }} />
            </div>

            <button id="btn-login-google" type="button" className="btn ui-login-box-18" style={{ padding: "0.75rem", width: "100%", marginBottom: "0.9375rem" }} onClick={() => handleAuthAction(isGuest ? linkGoogleAccount : login)}>
                <svg style={{ width: "1.25rem", height: "1.25rem", marginRight: "0.625rem", fill: "currentColor", verticalAlign: "middle" }} viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Accedi con Google
            </button>

            {onCancel ? (
                <button
                    type="button"
                    className="btn ui-login-box-19"
                    style={{ width: "100%", padding: "0.625rem", textDecoration: "underline" }}
                    onClick={onCancel}
                >
                    Torna alla modalità locale
                </button>
            ) : (
                <button
                    id="btn-login-anonymous"
                    type="button"
                    className="btn ui-login-box-20"
                    style={{ width: "100%", padding: "0.625rem", textDecoration: "underline" }}
                    onClick={loginAsGuest}
                >
                    Continua senza account
                </button>
            )}

            {!onCancel && (
                <p className="ui-login-box-21" style={{ marginTop: "0.3125rem", lineHeight: 1.4 }}>
                    I dati saranno salvati solo sul dispositivo.
                </p>
            )}
        </div>
    );
};
