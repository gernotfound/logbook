import { useState, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../hooks/useSettings';
import { useDialogStore } from '../../store/useDialogStore';
import { provider, linkWithPopup, linkWithCredential, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider, reauthenticateWithPopup } from '../../lib/firebase';
import { Eye, EyeOff } from 'lucide-react';

export const AccountCard = () => {
    const { currentUser, isGuest, linkGoogleAccount } = useAuth();
    const { handleLogout } = useSettings();
    const { showAlert } = useDialogStore();

    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [showReauthModal, setShowReauthModal] = useState<'email' | 'password' | 'linkEmail' | null>(null);
    const [currentPasswordInput, setCurrentPasswordInput] = useState('');
    const [newEmailInput, setNewEmailInput] = useState('');
    const [newPasswordInput, setNewPasswordInput] = useState('');
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);

    const providers = useMemo(() => {
        if (!currentUser) return [];
        return currentUser.providerData.map(p => p.providerId);
    }, [currentUser]);

    const hasGoogle = providers.includes('google.com');
    const hasPassword = providers.includes('password');

    const checkPasswordStrength = (pass: string) => {
        if (pass.length < 8) return "La password deve contenere almeno 8 caratteri.";
        if (!/\d/.test(pass)) return "La password deve contenere almeno 1 numero.";
        if (!/[a-z]/.test(pass)) return "La password deve contenere almeno 1 lettera minuscola.";
        if (!/[A-Z]/.test(pass)) return "La password deve contenere almeno 1 lettera maiuscola.";
        if (!/[!@#$%^&*(),.?":{}|<>_\+\-]/.test(pass)) return "La password deve contenere almeno 1 carattere speciale.";
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

    if (isGuest) {
        return (
            <div className="card">
                <h2 style={{color: 'var(--warning-color)',marginTop: 0}}><span aria-hidden="true">⚠️</span> Modalità locale</h2>
                <p style={{ fontSize: '0.85rem', marginBottom: '15px' }}>
                    Stai usando LogBook senza un account. I tuoi dati sono salvati solo su questo dispositivo.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button className="btn btn-primary" onClick={linkGoogleAccount}>
                        Collega account Google
                    </button>
                    <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={handleLogout}>Esci dalla modalità locale</button>
                </div>
            </div>
        );
    }

    return (
        <div className="card">
            <h2 style={{color: 'var(--primary-color)',marginTop: 0}}>Il tuo Account</h2>
            
            {currentUser && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                    {currentUser.photoURL ? (
                        <img src={currentUser.photoURL} alt="Avatar" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
                    ) : (
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary-color)', color: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                            {currentUser.email?.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <div>
                        <div style={{ fontWeight: 'bold' }}>{currentUser.displayName || 'Utente LogBook'}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{currentUser.email}</div>
                    </div>
                </div>
            )}

            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px', marginBottom: '15px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Metodi di accesso collegati:</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {hasGoogle && <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Google</span>}
                    {hasPassword && <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Email / Password</span>}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {hasPassword && (
                    <>
                        <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => { setShowReauthModal('email'); setShowCurrentPassword(false); setShowNewPassword(false); }}>Cambia Indirizzo Email</button>
                        <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => { setShowReauthModal('password'); setShowCurrentPassword(false); setShowNewPassword(false); }}>Cambia Password</button>
                    </>
                )}

                {!hasGoogle && (
                    <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={onLinkGoogle} disabled={loadingAction === 'linkGoogle'}>
                        {loadingAction === 'linkGoogle' ? 'Collegamento...' : 'Collega Account Google'}
                    </button>
                )}

                {!hasPassword && (
                    <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => { setShowReauthModal('linkEmail'); setShowCurrentPassword(false); setShowNewPassword(false); }}>
                        Crea Password per accedere con Email
                    </button>
                )}

                <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '10px 0' }} />
                <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => handleLogout()}>Esci dall'account</button>
            </div>

            {showReauthModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--surface-color)', padding: '20px', borderRadius: '12px', width: '90%', maxWidth: '350px', border: '1px solid var(--glass-border)' }}>
                        <h3 style={{ marginTop: 0 }}>
                            {showReauthModal === 'email' ? 'Cambia Email' : showReauthModal === 'password' ? 'Cambia Password' : 'Crea Password'}
                        </h3>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
                            {showReauthModal === 'email' && (
                                <input type="email" placeholder="Nuova Email" value={newEmailInput} onChange={e => setNewEmailInput(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'black', color: 'white' }} />
                            )}
                            
                            {(showReauthModal === 'password' || showReauthModal === 'linkEmail') && (
                                <div style={{ position: 'relative' }}>
                                    <input type={showNewPassword ? "text" : "password"} placeholder="Nuova Password" value={newPasswordInput} onChange={e => setNewPasswordInput(e.target.value)} style={{ padding: '10px', paddingRight: '40px', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'black', color: 'white', width: '100%', boxSizing: 'border-box' }} />
                                    <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                        {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            )}
                            
                            {hasPassword && (
                                <div style={{ position: 'relative' }}>
                                    <input type={showCurrentPassword ? "text" : "password"} placeholder="Password Attuale" value={currentPasswordInput} onChange={e => setCurrentPasswordInput(e.target.value)} style={{ padding: '10px', paddingRight: '40px', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'black', color: 'white', width: '100%', boxSizing: 'border-box' }} />
                                    <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                        {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            )}
                            
                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={() => { setShowReauthModal(null); setCurrentPasswordInput(''); setNewEmailInput(''); setNewPasswordInput(''); }}>Annulla</button>
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
