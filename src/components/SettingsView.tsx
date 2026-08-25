import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAuth } from '../hooks/useAuth';
import { useDialogStore } from '../store/useDialogStore';
import { PrivacyPolicy } from '../pages/PrivacyPolicy';
import { setAnalyticsConsent } from '../lib/firebase';
import { getStorageDiagnosticData } from '../lib/storageStatus';

const SettingsView = () => {
    const {
        currentUser, handleLogout,
        deletingAccount,
        handleExport, handleDeleteAccount
    } = useSettings();

    const { isGuest, linkGoogleAccount } = useAuth();
    const { isInstallable, isIOSInstallable, promptInstall } = usePWAInstall();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [analyticsEnabled, setAnalyticsEnabled] = useState(localStorage.getItem('logbook_analytics_consent') !== 'false');

    const handleAnalyticsToggle = () => {
        const newState = !analyticsEnabled;
        setAnalyticsEnabled(newState);
        setAnalyticsConsent(newState);
    };

    const handleCheckUpdate = async () => {
        if ('serviceWorker' in navigator) {
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) {
                    await reg.update();
                    useDialogStore.getState().showAlert("Controllo aggiornamenti inviato. Se è disponibile una nuova versione, il banner di aggiornamento comparirà a breve in basso.");
                } else {
                    useDialogStore.getState().showAlert("Nessun Service Worker trovato. Assicurati che l'app sia installata correttamente.");
                }
            } catch (err) {
                useDialogStore.getState().showAlert("Errore durante il controllo degli aggiornamenti.");
            }
        } else {
            useDialogStore.getState().showAlert("Il tuo browser non supporta gli aggiornamenti in background.");
        }
    };

    useEffect(() => {
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return (
        <div id="view-settings" className="view-section active">
            <h1 style={{ marginBottom: '15px', fontSize: '1.5rem' }}>⚙️ Impostazioni</h1>

            {isGuest ? (
                <div className="section-divider">
                    <h2 style={{ color: 'var(--warning-color)', fontSize: '1.2rem', marginTop: 0 }}>⚠️ Modalità locale</h2>
                    <p style={{ fontSize: '0.85rem', marginBottom: '15px' }}>
                        Stai usando LogBook senza un account. I tuoi dati sono salvati solo su questo dispositivo e non possono essere recuperati se perdi l'accesso al browser.
                    </p>
                    <button
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        onClick={linkGoogleAccount}
                    >
                        <svg style={{width:'18px', height:'18px', marginRight:'8px', fill:'currentColor', verticalAlign:'middle'}} viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                        Collega account Google
                    </button>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '10px', textAlign: 'center' }}>
                        Il collegamento trasferisce i tuoi dati sul cloud senza perdere nulla.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
                        <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={handleLogout}>Esci dalla modalità locale</button>
                    </div>
                </div>
            ) : (
                <div className="section-divider">
                    <h2 style={{ color: 'var(--primary-color)', fontSize: '1.2rem', marginTop: 0 }}>Account Google</h2>
                    {currentUser && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                            {currentUser.photoURL && <img src={currentUser.photoURL} alt="Avatar" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />}
                            <div>
                                <div style={{ fontWeight: 'bold' }}>{currentUser.displayName}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentUser.email}</div>
                            </div>
                        </div>
                    )}
                    <p style={{ fontSize: '0.8rem' }}>I tuoi dati sono sincronizzati automaticamente sul cloud.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
                        <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={handleLogout}>Esci dall'account</button>
                    </div>
                </div>
            )}

            {isInstallable && (
                <div className="section-divider">
                    <button className="btn btn-primary" style={{ width: '100%', marginBottom: 0 }} onClick={promptInstall}>
                        📱 Installa app sul telefono
                    </button>
                </div>
            )}

            {isIOSInstallable && (
                <div className="section-divider">
                    <h3 style={{ margin: '0 0 8px 0', color: 'var(--primary-color)', fontSize: '0.95rem' }}>
                        📱 Installa su iPhone / iPad
                    </h3>
                    <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.4, color: 'var(--text-main)' }}>
                        Per installare LogBook come app a schermo intero: tocca l'icona <strong>Condividi</strong> in Safari e seleziona <strong>"Aggiungi alla schermata Home"</strong>.
                    </p>
                </div>
            )}

            <div className="section-divider">
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', marginBottom: 0 }} onClick={handleExport}>
                    💾 Esporta dati (CSV)
                </button>
            </div>

            <div className="section-divider">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ margin: '0 0 5px 0', fontSize: '1rem', color: 'var(--text-main)' }}>Statistiche di utilizzo</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Condividi dati anonimi di diagnostica e Analytics per aiutarci a migliorare l'app.</p>
                    </div>
                    <input type="checkbox" id="analytics-toggle" checked={analyticsEnabled} onChange={handleAnalyticsToggle} style={{ width: '24px', height: '24px', accentColor: 'var(--primary-color)', marginLeft: '10px' }} />
                </div>
            </div>

            <div className="section-divider">
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', marginBottom: 0 }} onClick={handleCheckUpdate}>
                    🔄 Cerca aggiornamenti
                </button>
            </div>

            <div className="section-divider">
                <h3 style={{ margin: '0 0 10px 0', fontSize: '0.95rem' }}>🔧 Diagnostica archiviazione</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 10px 0' }}>Stato della persistenza dei dati offline su questo dispositivo.</p>
                {(() => {
                    const storageDiag = getStorageDiagnosticData();
                    if (!storageDiag) return <span style={{ fontSize: '0.85rem' }}>Caricamento...</span>;
                    if (!storageDiag.supported) return <span style={{ fontSize: '0.85rem', color: 'var(--danger-color)' }}>Persistenza non supportata (Storage API mancante).</span>;
                    return (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                <span>Stato:</span>
                                <span style={{ color: storageDiag.persistent ? 'var(--success-color)' : 'var(--warning-color)', fontWeight: 'bold' }}>
                                    {storageDiag.persistent ? 'Persistente (Sicuro)' : 'Best-Effort (Volatile)'}
                                </span>
                            </div>
                            {storageDiag.usage !== undefined && storageDiag.quota !== undefined && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Utilizzo:</span>
                                    <span>{(storageDiag.usage / 1024 / 1024).toFixed(2)} MB / {(storageDiag.quota / 1024 / 1024).toFixed(2)} MB</span>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>

            <div className="section-divider">
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', marginBottom: 0 }} onClick={() => setShowPrivacy(true)}>
                    📄 Informativa sulla privacy
                </button>
            </div>

            {isOffline && (
                <div className="section-divider">
                    <h2 style={{ color: 'var(--warning-color)', fontSize: '1.2rem', marginTop: 0 }}>⚠️ Connessione assente</h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', margin: 0 }}>
                        Sei attualmente offline. Puoi continuare a usare l'app: tutte le modifiche verranno salvate localmente e sincronizzate con il cloud non appena tornerà la connessione.
                    </p>
                </div>
            )}

            {/* Danger Zone */}
            <div style={{ marginBottom: '100px' }}>
                <h2 style={{ color: 'var(--danger-color)', fontSize: '1.2rem', marginTop: 0 }}>⚠️ Zona pericolosa</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                    {isGuest
                        ? "Elimina permanentemente tutti i dati salvati su questo dispositivo. Questa azione è irreversibile."
                        : "Elimina permanentemente il tuo account e tutti i dati associati. Questa azione è irreversibile."
                    }
                </p>
                <button 
                    className="btn" 
                    style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger-color)', border: '1px solid var(--danger-color)', width: '100%', marginBottom: 0 }}
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount}
                >
                    {deletingAccount ? '⏳ Eliminazione...' : (isGuest ? '🗑️ Elimina dati locali' : '🗑️ Elimina account e dati')}
                </button>
            </div>


            {showPrivacy && (
                <PrivacyPolicy onClose={() => setShowPrivacy(false)} />
            )}

            <div style={{ textAlign: 'center', marginTop: '30px', marginBottom: '10px' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Versione {__APP_VERSION__} &middot; build {__BUILD_HASH__} &middot; {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(__BUILD_TIME__))}
                </p>
            </div>
        </div>

    );
};

export default SettingsView;
