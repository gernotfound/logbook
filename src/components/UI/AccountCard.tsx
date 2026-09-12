import { useMemo, useState } from 'react';
import { Cloud, Eye, EyeOff, KeyRound, Link2, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../hooks/useSettings';
import { useDialogStore } from '../../store/useDialogStore';
import { provider, linkWithPopup, linkWithCredential, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider, reauthenticateWithPopup } from '../../lib/firebase';

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
        return (currentUser.providerData || []).map(item => item.providerId);
    }, [currentUser]);
    const hasGoogle = providers.includes('google.com');
    const hasPassword = providers.includes('password');

    const checkPasswordStrength = (pass: string) => {
        if (pass.length < 8) return 'La password deve contenere almeno 8 caratteri.';
        if (!/\d/.test(pass)) return 'La password deve contenere almeno 1 numero.';
        if (!/[a-z]/.test(pass)) return 'La password deve contenere almeno 1 lettera minuscola.';
        if (!/[A-Z]/.test(pass)) return 'La password deve contenere almeno 1 lettera maiuscola.';
        if (!/[!@#$%^&*(),.?":{}|<>_+-]/.test(pass)) return 'La password deve contenere almeno 1 carattere speciale.';
        return null;
    };

    const resetModal = () => {
        setShowReauthModal(null);
        setCurrentPasswordInput('');
        setNewEmailInput('');
        setNewPasswordInput('');
        setShowCurrentPassword(false);
        setShowNewPassword(false);
    };

    const handleReauthenticate = async () => {
        if (!currentUser || !currentUser.email) return false;
        try {
            if (hasPassword && currentPasswordInput) {
                const credential = EmailAuthProvider.credential(currentUser.email, currentPasswordInput);
                await reauthenticateWithCredential(currentUser, credential);
                return true;
            }
            if (hasGoogle && !hasPassword) {
                await reauthenticateWithPopup(currentUser, provider);
                return true;
            }
            return false;
        } catch (error: any) {
            console.error('Reauth error', error);
            await showAlert('Autenticazione fallita. Controlla la password attuale.');
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
                    await showAlert('Email non valida.');
                    return;
                }
                await updateEmail(currentUser, newEmailInput);
                await showAlert('Email aggiornata con successo.');
            } else if (showReauthModal === 'password' || showReauthModal === 'linkEmail') {
                const weakError = checkPasswordStrength(newPasswordInput);
                if (weakError) {
                    await showAlert(weakError);
                    return;
                }
                if (showReauthModal === 'password') {
                    await updatePassword(currentUser, newPasswordInput);
                    await showAlert('Password aggiornata con successo.');
                } else {
                    const credential = EmailAuthProvider.credential(currentUser.email || '', newPasswordInput);
                    try {
                        await linkWithCredential(currentUser, credential);
                        await showAlert('Email e password collegate con successo.');
                    } catch (linkError: any) {
                        if (linkError.code === 'auth/credential-already-in-use') await showAlert('Questa email è già associata a un altro account.');
                        else throw linkError;
                    }
                }
            }
            resetModal();
            window.location.reload();
        } catch (error: any) {
            console.error('Action error', error);
            await showAlert('Errore durante l’operazione: ' + error.message);
        } finally {
            setLoadingAction(null);
        }
    };

    const onLinkGoogle = async () => {
        if (!currentUser) return;
        try {
            setLoadingAction('linkGoogle');
            await linkWithPopup(currentUser, provider);
            await showAlert('Account Google collegato con successo!');
            window.location.reload();
        } catch (error: any) {
            if (error.code === 'auth/credential-already-in-use') await showAlert('Questo account Google è già collegato a un altro utente.');
            else await showAlert('Errore durante il collegamento di Google.');
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
            await showAlert('Email non valida.');
            return;
        }
        setLoadingAction('guestRegister');
        try {
            await registerWithEmail(newEmailInput, newPasswordInput);
            window.location.reload();
        } catch (error: any) {
            setLoadingAction(null);
            console.error('Registrazione guest fallita', error);
        }
    };

    const modalTitle = showReauthModal === 'guestRegister'
        ? 'Crea account'
        : showReauthModal === 'email'
            ? 'Cambia email'
            : showReauthModal === 'password'
                ? 'Cambia password'
                : 'Crea password';

    const renderAccountModal = () => {
        if (!showReauthModal) return null;
        const isGuestRegister = showReauthModal === 'guestRegister';
        return (
            <div className="account-modal-overlay" role="presentation">
                <section className="account-modal" role="dialog" aria-modal="true" aria-label={modalTitle}>
                    <div className="account-modal__header">
                        <div className="account-modal__icon"><KeyRound size={19} aria-hidden="true" /></div>
                        <div>
                            <h3>{modalTitle}</h3>
                            <p>{isGuestRegister ? 'I dati locali verranno collegati al nuovo account cloud.' : 'Per sicurezza potrebbe essere richiesta una nuova autenticazione.'}</p>
                        </div>
                    </div>

                    <div className="account-modal__fields">
                        {(isGuestRegister || showReauthModal === 'email') && (
                            <label className="auth-field">
                                <Mail size={17} aria-hidden="true" />
                                <input
                                    type="email"
                                    placeholder={isGuestRegister ? 'La tua email' : 'Nuova email'}
                                    value={newEmailInput}
                                    onChange={event => setNewEmailInput(event.target.value)}
                                    autoComplete="email"
                                />
                            </label>
                        )}

                        {(isGuestRegister || showReauthModal === 'password' || showReauthModal === 'linkEmail') && (
                            <label className="auth-field auth-field--password">
                                <KeyRound size={17} aria-hidden="true" />
                                <input
                                    type={showNewPassword ? 'text' : 'password'}
                                    placeholder="Nuova password"
                                    value={newPasswordInput}
                                    onChange={event => setNewPasswordInput(event.target.value)}
                                    autoComplete="new-password"
                                />
                                <button type="button" className="auth-password-toggle" onClick={() => setShowNewPassword(value => !value)} aria-label={showNewPassword ? 'Nascondi nuova password' : 'Mostra nuova password'}>
                                    {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </label>
                        )}

                        {!isGuestRegister && hasPassword && (
                            <label className="auth-field auth-field--password">
                                <ShieldCheck size={17} aria-hidden="true" />
                                <input
                                    type={showCurrentPassword ? 'text' : 'password'}
                                    placeholder="Password attuale"
                                    value={currentPasswordInput}
                                    onChange={event => setCurrentPasswordInput(event.target.value)}
                                    autoComplete="current-password"
                                />
                                <button type="button" className="auth-password-toggle" onClick={() => setShowCurrentPassword(value => !value)} aria-label={showCurrentPassword ? 'Nascondi password attuale' : 'Mostra password attuale'}>
                                    {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </label>
                        )}
                    </div>

                    <div className="account-modal__actions">
                        <button className="btn btn-secondary" type="button" onClick={resetModal}>Annulla</button>
                        <button className="btn btn-primary" type="button" onClick={isGuestRegister ? onGuestRegister : submitReauth} disabled={isGuestRegister ? loadingAction === 'guestRegister' : !!loadingAction}>
                            {(loadingAction === 'guestRegister' || loadingAction === 'reauth') ? 'Attendere...' : (isGuestRegister ? 'Registrati' : 'Conferma')}
                        </button>
                    </div>
                </section>
            </div>
        );
    };

    if (isGuest) {
        return (
            <section className="account-card account-card--guest">
                <div className="account-card__header">
                    <div className="account-avatar account-avatar--guest"><UserRound size={20} aria-hidden="true" /></div>
                    <div>
                        <span className="account-card__eyebrow">Modalità locale</span>
                        <h2>Dati solo su questo dispositivo</h2>
                        <p>Puoi continuare offline oppure creare un account e portare con te i dati già registrati.</p>
                    </div>
                </div>
                <div className="account-actions">
                    <button className="btn btn-primary" type="button" onClick={linkGoogleAccount}><Cloud size={18} /> Crea account con Google</button>
                    <button className="btn btn-secondary" type="button" onClick={() => setShowReauthModal('guestRegister')}><Mail size={18} /> Crea account con Email e Password</button>
                    <button className="btn account-logout" type="button" onClick={handleLogout}><LogOut size={18} /> Esci dalla modalità locale</button>
                </div>
                {renderAccountModal()}
            </section>
        );
    }

    return (
        <section className="account-card">
            <div className="account-card__header">
                {currentUser?.photoURL ? (
                    <img className="account-avatar" src={currentUser.photoURL} alt="Avatar" />
                ) : (
                    <div className="account-avatar">{currentUser?.email?.charAt(0).toUpperCase() || <UserRound size={20} />}</div>
                )}
                <div className="account-card__identity">
                    <span className="account-card__eyebrow">Il tuo account</span>
                    <h2>{currentUser?.displayName || 'Utente LogBook'}</h2>
                    <p>{currentUser?.email}</p>
                </div>
            </div>

            <div className="account-providers">
                <span className="account-providers__label">Metodi di accesso</span>
                <div>
                    {hasGoogle && <span><Cloud size={13} /> Google</span>}
                    {hasPassword && <span><Mail size={13} /> Email / Password</span>}
                </div>
            </div>

            <div className="account-actions">
                {hasPassword && (
                    <>
                        <button className="btn btn-secondary" type="button" onClick={() => { setShowReauthModal('email'); setShowCurrentPassword(false); setShowNewPassword(false); }}><Mail size={18} /> Cambia indirizzo email</button>
                        <button className="btn btn-secondary" type="button" onClick={() => { setShowReauthModal('password'); setShowCurrentPassword(false); setShowNewPassword(false); }}><KeyRound size={18} /> Cambia password</button>
                    </>
                )}
                {!hasGoogle && (
                    <button className="btn btn-secondary" type="button" onClick={onLinkGoogle} disabled={loadingAction === 'linkGoogle'}><Link2 size={18} /> {loadingAction === 'linkGoogle' ? 'Collegamento...' : 'Collega Account Google'}</button>
                )}
                {!hasPassword && (
                    <button className="btn btn-secondary" type="button" onClick={() => { setShowReauthModal('linkEmail'); setShowCurrentPassword(false); setShowNewPassword(false); }}><KeyRound size={18} /> Crea password per accedere con Email</button>
                )}
                <button className="btn account-logout" type="button" onClick={() => handleLogout()}><LogOut size={18} /> Esci dall'account</button>
            </div>
            {renderAccountModal()}
        </section>
    );
};
