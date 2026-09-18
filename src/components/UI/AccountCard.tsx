import { useState, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../hooks/useSettings';
import { useDialogStore } from '../../store/useDialogStore';
import { provider, linkWithPopup, linkWithCredential, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider, reauthenticateWithPopup } from '../../lib/firebase';
import { Eye, EyeOff } from 'lucide-react';

export const AccountCard = () => {
    const { currentUser, isGuest, linkGoogleAccount, registerWithEmail } = useAuth();
    const { handleLogout } = useSettings();
    const { showAlert } = useDialogStore();

    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [showReauthModal, setShowReauthModal] = useState<'email' | 'password' | 'linkEmail' | 'guestRegister' | null>(null);
    const [currentPasswordInput, setCurrentPasswordInput] = useState('');
    const [newEmailInput, setNewEmailInput] = useState('');
    const [newPasswordInput, setNewPasswordInput] = useState('');
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);

    const providers = useMemo(() => {
        if (!currentUser) return [];
        return (currentUser.providerData || []).map(p => p.providerId);
    }, [currentUser]);

    const hasGoogle = providers.includes('google.com');
    const hasPassword = providers.includes('password');

    const checkPasswordStrength = (pass: string) => {
        if (pass.length < 8) return "La password deve contenere almeno 8 caratteri.";
        if (!/\d/.test(pass)) return "La password deve contenere almeno 1 numero.";
        if (!/[a-z]/.test(pass)) return "La password deve contenere almeno 1 lettera minuscola.";
        if (!/[A-Z]/.test(pass)) return "La password deve contenere almeno 1 lettera maiuscola.";
        if (!/[!@#$%^&*(),.?":{}|<>_+-]/.test(pass)) return "La password deve contenere almeno 1 carattere speciale.";
        return null;
    };

    const handleReauthenticate = async () => {
        if (!currentUser || !currentUser.email) return false;
        try {
            if (hasPassword && currentPasswordInput) {
                const cred = EmailAuthProvider.credential(currentUser.email, currentPasswordInput);
                await reauthenticateWithCredential(currentUser, cred);
                return true;
            } else if (hasGoogle && !hasPassword) {
                await reauthenticateWithPopup(currentUser, provider);
                return true;
            }
            return false;
        } catch (error: any) {
            console.error("Reauth error", error);
            await showAlert("Autenticazione fallita. Controlla la password attuale.");
            return false;
        }
    };

    const submitReauth = async () => {
        if (!currentUser) return;
        setLoadingAction('reauth');

        const isReauthSuccess = await handleReauthenticate();
        if (!isReauthSuccess) {
            setLoadingAction(null);
            return;
        }

        try {
            if (showReauthModal === 'email') {
                if (!newEmailInput || !newEmailInput.includes('@')) {
                    await showAlert("Email non valida.");
                    setLoadingAction(null);
                    return;
                }
                await updateEmail(currentUser, newEmailInput);
                await showAlert("Email aggiornata con successo.");
            } else if (showReauthModal === 'password' || showReauthModal === 'linkEmail') {
                const weakError = checkPasswordStrength(newPasswordInput);
                if (weakError) {
                    await showAlert(weakError);
                    setLoadingAction(null);
                    return;
                }

                if (showReauthModal === 'password') {
                    await updatePassword(currentUser, newPasswordInput);
                    await showAlert("Password aggiornata con successo.");
                } else {
                    const cred = EmailAuthProvider.credential(currentUser.email || '', newPasswordInput);
                    try {
                        await linkWithCredential(currentUser, cred);
                        await showAlert("Email e password collegate con successo.");
                    } catch (linkError: any) {
                        if (linkError.code === 'auth/credential-already-in-use') {
                            await showAlert("Questa email è già associata a un altro account.");
                        } else {
                            throw linkError;
                        }
                    }
                }
            }
            setShowReauthModal(null);
            setCurrentPasswordInput('');
            setNewEmailInput('');
            setNewPasswordInput('');
            setShowCurrentPassword(false);
            setShowNewPassword(false);
            window.location.reload(); // Ricarica per aggiornare stato utente pulito
        } catch (error: any) {
            console.error("Action error", error);
            await showAlert("Errore durante l'operazione: " + error.message);
        } finally {
            setLoadingAction(null);
        }
    };

    const onLinkGoogle = async () => {
        if (!currentUser) return;
        try {
            setLoadingAction('linkGoogle');
            await linkWithPopup(currentUser, provider);
            await showAlert("Account Google collegato con successo!");
            window.location.reload();
        } catch (error: any) {
            if (error.code === 'auth/credential-already-in-use') {
                await showAlert("Questo account Google è già collegato a un altro utente.");
            } else {
                await showAlert("Errore durante il collegamento di Google.");
            }
        } finally {
            setLoadingAction(null);
        }
    };

    const onGuestRegister = async () => {
        const weakError = checkPasswordStrength(newPasswordInput);
        if (weakError) {
            await showAlert(weakError);
            return;
        }
        if (!newEmailInput || !newEmailInput.includes('@')) {
            await showAlert("Email non valida.");
            return;
        }
        setLoadingAction('guestRegister');
        try {
            await registerWithEmail(newEmailInput, newPasswordInput);
            // La migrazione avviene automaticamente in onAuthStateChanged
            window.location.reload();
        } catch (error: any) {
            setLoadingAction(null);
            // Errori gestiti da AuthContext (handleAuthError)
            console.error("Registrazione guest fallita", error);
        }
    };

    if (isGuest) {
        return (
            <div className="card">
                <h2 className="ui-account-card-1" style={{ marginTop: 0 }}><span aria-hidden="true">⚠️</span> Modalità locale</h2>
                <p className="ui-account-card-2" style={{ marginBottom: "0.9375rem" }}>
                    Stai usando LogBook senza un account. I tuoi dati sono salvati solo su questo dispositivo.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                    <button className="btn btn-primary" onClick={linkGoogleAccount}>
                        Crea account con Google
                    </button>
                    <button className="btn ui-account-card-3"  onClick={() => setShowReauthModal('guestRegister')}>
                        Crea account con Email e Password
                    </button>
                    <hr className="ui-account-card-4" style={{ margin: "0.625rem 0" }} />
                    <button className="btn ui-account-card-5"  onClick={handleLogout}>Esci dalla modalità locale</button>
                </div>

                {showReauthModal === 'guestRegister' && (
                    <div className="ui-account-card-6" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div className="ui-account-card-7" style={{ padding: "1.25rem", width: "90%", maxWidth: "21.875rem" }}>
                            <h3 style={{ marginTop: 0 }}>Crea Account</h3>
                            <p className="ui-account-card-8" >I tuoi dati locali verranno salvati sul cloud.</p>

                            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginTop: "0.9375rem" }}>
                                <input type="email" placeholder="La tua Email" value={newEmailInput} onChange={e => setNewEmailInput(e.target.value)} autoComplete="email" className="ui-account-card-9" style={{ padding: "0.625rem" }} />

                                <div style={{ position: "relative" }}>
                                    <input type={showNewPassword ? "text" : "password"} placeholder="Nuova Password" value={newPasswordInput} onChange={e => setNewPasswordInput(e.target.value)} autoComplete="new-password" className="ui-account-card-10" style={{ padding: "0.625rem", paddingRight: "2.5rem", width: "100%", boxSizing: "border-box" }} />
                                    <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="ui-account-card-11" style={{ position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                                        {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>

                                <div style={{ display: "flex", gap: "0.625rem", marginTop: "0.625rem" }}>
                                    <button className="btn ui-account-card-12" style={{ flex: 1 }} onClick={() => { setShowReauthModal(null); setNewEmailInput(''); setNewPasswordInput(''); }}>Annulla</button>
                                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={onGuestRegister} disabled={loadingAction === 'guestRegister'}>
                                        {loadingAction === 'guestRegister' ? 'Attendere...' : 'Registrati'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="card">
            <h2 className="ui-account-card-13" style={{ marginTop: 0 }}>Il tuo Account</h2>

            {currentUser && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "1.25rem" }}>
                    {currentUser.photoURL ? (
                        <img src={currentUser.photoURL} alt="Avatar" className="ui-account-card-14" style={{ width: "2.5rem", height: "2.5rem" }} />
                    ) : (
                        <div className="ui-account-card-15" style={{ width: "2.5rem", height: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>
                            {currentUser.email?.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <div>
                        <div style={{ fontWeight: "bold" }}>{currentUser.displayName || 'Utente LogBook'}</div>
                        <div className="ui-account-card-16" >{currentUser.email}</div>
                    </div>
                </div>
            )}

            <div className="ui-account-card-17" style={{ padding: "0.625rem", marginBottom: "0.9375rem" }}>
                <div className="ui-account-card-18" style={{ marginBottom: "0.625rem" }}>Metodi di accesso collegati:</div>
                <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
                    {hasGoogle && <span className="ui-account-card-19" style={{ padding: "0.25rem 0.5rem" }}>Google</span>}
                    {hasPassword && <span className="ui-account-card-20" style={{ padding: "0.25rem 0.5rem" }}>Email / Password</span>}
                </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                {hasPassword && (
                    <>
                        <button className="btn ui-account-card-21"  onClick={() => { setShowReauthModal('email'); setShowCurrentPassword(false); setShowNewPassword(false); }}>Cambia Indirizzo Email</button>
                        <button className="btn ui-account-card-22"  onClick={() => { setShowReauthModal('password'); setShowCurrentPassword(false); setShowNewPassword(false); }}>Cambia Password</button>
                    </>
                )}

                {!hasGoogle && (
                    <button className="btn ui-account-card-23"  onClick={onLinkGoogle} disabled={loadingAction === 'linkGoogle'}>
                        {loadingAction === 'linkGoogle' ? 'Collegamento...' : 'Collega Account Google'}
                    </button>
                )}

                {!hasPassword && (
                    <button className="btn ui-account-card-24"  onClick={() => { setShowReauthModal('linkEmail'); setShowCurrentPassword(false); setShowNewPassword(false); }}>
                        Crea Password per accedere con Email
                    </button>
                )}

                <hr className="ui-account-card-25" style={{ margin: "0.625rem 0" }} />
                <button className="btn ui-account-card-26"  onClick={() => handleLogout()}>Esci dall'account</button>
            </div>

            {showReauthModal && (
                <div className="ui-account-card-27" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div className="ui-account-card-28" style={{ padding: "1.25rem", width: "90%", maxWidth: "21.875rem" }}>
                        <h3 style={{ marginTop: 0 }}>
                            {showReauthModal === 'email' ? 'Cambia Email' : showReauthModal === 'password' ? 'Cambia Password' : 'Crea Password'}
                        </h3>

                        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginTop: "0.9375rem" }}>
                            {showReauthModal === 'email' && (
                                <input type="email" placeholder="Nuova Email" value={newEmailInput} onChange={e => setNewEmailInput(e.target.value)} autoComplete="email" className="ui-account-card-29" style={{ padding: "0.625rem" }} />
                            )}

                            {(showReauthModal === 'password' || showReauthModal === 'linkEmail') && (
                                <div style={{ position: "relative" }}>
                                    <input type={showNewPassword ? "text" : "password"} placeholder="Nuova Password" value={newPasswordInput} onChange={e => setNewPasswordInput(e.target.value)} autoComplete="new-password" className="ui-account-card-30" style={{ padding: "0.625rem", paddingRight: "2.5rem", width: "100%", boxSizing: "border-box" }} />
                                    <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="ui-account-card-31" style={{ position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                                        {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            )}

                            {hasPassword && (
                                <div style={{ position: "relative" }}>
                                    <input type={showCurrentPassword ? "text" : "password"} placeholder="Password Attuale" value={currentPasswordInput} onChange={e => setCurrentPasswordInput(e.target.value)} autoComplete="current-password" className="ui-account-card-32" style={{ padding: "0.625rem", paddingRight: "2.5rem", width: "100%", boxSizing: "border-box" }} />
                                    <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} className="ui-account-card-33" style={{ position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                                        {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            )}

                            <div style={{ display: "flex", gap: "0.625rem", marginTop: "0.625rem" }}>
                                <button className="btn ui-account-card-34" style={{ flex: 1 }} onClick={() => { setShowReauthModal(null); setCurrentPasswordInput(''); setNewEmailInput(''); setNewPasswordInput(''); }}>Annulla</button>
                                <button className="btn btn-primary" style={{ flex: 1 }} onClick={submitReauth} disabled={!!loadingAction}>
                                    {loadingAction === 'reauth' ? 'Attendere...' : 'Conferma'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
