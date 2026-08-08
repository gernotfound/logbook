import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAuth } from '../hooks/useAuth';

const SettingsView = () => {
    const {
        currentUser, handleLogout,
        deletingAccount,
        handleExport, handleDeleteAccount
    } = useSettings();

    const { isAnonymous, linkGoogleAccount } = useAuth();
    const { isInstallable, isIOSInstallable, promptInstall } = usePWAInstall();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showPrivacy, setShowPrivacy] = useState(false);

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
            <h2 style={{ marginBottom: '15px' }}>⚙️ Impostazioni</h2>

            {isAnonymous ? (
                <div className="card" style={{ border: '1px solid var(--warning-color)' }}>
                    <h3 style={{ color: 'var(--warning-color)' }}>⚠️ Modalità locale</h3>
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
                </div>
            ) : (
                <div className="card" style={{ border: '1px solid var(--primary-color)' }}>
                    <h3 style={{ color: 'var(--primary-color)' }}>Account Google</h3>
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
                <div style={{ marginTop: '15px' }}>
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={promptInstall}>
                        📱 Installa app sul telefono
                    </button>
                </div>
            )}

            {isIOSInstallable && (
                <div className="card" style={{ marginTop: '15px', border: '1px solid var(--primary-color)', background: 'rgba(14, 165, 233, 0.08)' }}>
                    <h4 style={{ margin: '0 0 8px 0', color: 'var(--primary-color)', fontSize: '0.95rem' }}>
                        📱 Installa su iPhone / iPad
                    </h4>
                    <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.4, color: 'var(--text-main)' }}>
                        Per installare LogBook come app a schermo intero: tocca l'icona <strong>Condividi</strong> in Safari e seleziona <strong>"Aggiungi alla schermata Home"</strong>.
                    </p>
                </div>
            )}

            <div style={{ marginTop: '15px' }}>
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%' }} onClick={handleExport}>
                    💾 Esporta dati (CSV)
                </button>
            </div>

            <div style={{ marginTop: '10px' }}>
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%' }} onClick={() => setShowPrivacy(true)}>
                    📄 Informativa sulla privacy
                </button>
            </div>

            {isOffline && (
                <div className="card" style={{ border: '1px solid var(--warning-color)', marginTop: '15px', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                    <h3 style={{ color: 'var(--warning-color)' }}>⚠️ Connessione assente</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', margin: 0 }}>
                        Sei attualmente offline. Puoi continuare a usare l'app: tutte le modifiche verranno salvate localmente e sincronizzate con il cloud non appena tornerà la connessione.
                    </p>
                </div>
            )}

            {/* Danger Zone */}
            <div className="card" style={{ border: '1px solid var(--danger-color)', marginTop: '20px', marginBottom: '100px' }}>
                <h3 style={{ color: 'var(--danger-color)' }}>⚠️ Zona pericolosa</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                    Elimina permanentemente il tuo account e tutti i dati associati. Questa azione è irreversibile.
                </p>
                <button 
                    className="btn" 
                    style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger-color)', border: '1px solid var(--danger-color)', width: '100%' }}
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount}
                >
                    {deletingAccount ? '⏳ Eliminazione...' : '🗑️ Elimina account e dati'}
                </button>
            </div>

            {showPrivacy && (
                <div className="dialog-overlay" style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(5px)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 99999
                }}>
                    <div className="dialog-box card" style={{
                        width: '90%',
                        maxWidth: '500px',
                        maxHeight: '80vh',
                        background: 'var(--surface-color)',
                        border: '1px solid var(--glass-border)',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
                        borderRadius: '16px',
                        padding: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        animation: 'fadeIn 0.2s ease-out'
                    }}>
                        <h2 style={{ color: 'var(--text-main)', margin: '0 0 15px 0', fontSize: '1.3rem', textAlign: 'center' }}>📄 Informativa sulla privacy</h2>
                        
                        <div style={{ 
                            flex: 1, 
                            overflowY: 'auto', 
                            textAlign: 'left', 
                            fontSize: '0.85rem', 
                            lineHeight: '1.5', 
                            color: 'var(--text-muted)',
                            paddingRight: '10px',
                            marginBottom: '20px'
                        }}>
                            <p><b>1. Titolare del trattamento</b><br />
                            L'applicazione LogBook è fornita come servizio di utilità personale. Ciascun utente mantiene il controllo diretto e autonomo sui propri dati, che possono essere gestiti, esportati o cancellati in qualsiasi momento tramite le funzionalità integrate nell'applicazione.</p>

                            <p><b>2. Dati raccolti</b><br />
                            Raccogliamo ed elaboriamo esclusivamente i dati strettamente necessari per il funzionamento dell'applicazione:
                            <ul>
                                <li><b>Dati di autenticazione:</b> Indirizzo email, nome e foto profilo (forniti tramite Google Login).</li>
                                <li><b>Dati biometrici:</b> Peso corporeo e altre misurazioni antropometriche inserite volontariamente.</li>
                                <li><b>Dati di allenamento e nutrizione:</b> Schede, storico esercizi, carichi, ripetizioni, note e diario alimentare quotidiano.</li>
                            </ul>
                            </p>

                            <p><b>3. Finalità e base giuridica</b><br />
                            I dati vengono raccolti esclusivamente per consentirti di tracciare e monitorare i tuoi allenamenti e la tua alimentazione. La base giuridica del trattamento è il tuo consenso esplicito, fornito creando un account e inserendo i dati nell'app.</p>

                            <p><b>4. Conservazione dei dati</b><br />
                            Tutti i dati vengono memorizzati e conservati in modo sicuro sui server cloud di Google Firebase, ospitati all'interno dell'Unione Europea o in conformità con i requisiti del Data Privacy Framework. Nessun dato viene venduto o condiviso con terze parti o per scopi pubblicitari.</p>

                            <p><b>5. Sicurezza dei dati</b><br />
                            L'app utilizza protocolli sicuri (HTTPS) per il trasferimento dei dati e le funzionalità di sicurezza integrate di Google Firebase. I dati sono associati in modo univoco al tuo account protetto.</p>

                            <p><b>6. Diritti dell'utente (GDPR)</b><br />
                            In conformità al Regolamento Europeo (GDPR), hai il diritto di:
                            <ul>
                                <li>Accedere a tutti i tuoi dati esportandoli in formato CSV tramite l'apposito tasto in Impostazioni.</li>
                                <li>Rettificare o modificare qualsiasi dato direttamente dall'interfaccia dell'applicazione.</li>
                                <li>Chiedere la cancellazione totale e definitiva dei tuoi dati. Puoi farlo autonomamente e in tempo reale premendo il pulsante "Elimina account e dati" in Impostazioni. Questa azione rimuoverà permanentemente la tua email e ogni dato di allenamento/nutrizione dai server di Firebase.</li>
                            </ul>
                            </p>

                            <p><b>7. Cookie, analitica e memoria locale</b><br />
                            Questo sito utilizza:<br />
                            - Memoria locale (LocalStorage) e identificatori tecnici essenziali per consentirti l'accesso persistente e la gestione offline delle sessioni.<br />
                            - <b>Google Analytics per Firebase</b> per raccogliere informazioni statistiche aggregate e anonime sull'utilizzo dell'app (es. flussi di navigazione, durata delle sessioni, arresti anomali). Questi dati ci consentono di ottimizzare le prestazioni dell'applicazione e non vengono mai utilizzati per scopi di marketing, tracciamento pubblicitario o profilazione commerciale.</p>
                        </div>

                        <button 
                            className="btn btn-primary" 
                            onClick={() => setShowPrivacy(false)}
                            style={{ padding: '12px', width: '100%', flexShrink: 0 }}
                        >
                            Chiudi
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SettingsView;
