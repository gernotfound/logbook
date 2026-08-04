import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';

const SettingsView = () => {
    const {
        currentUser, handleLogout,
        dob, setDob,
        height, setHeight,
        gender, setGender,
        deletingAccount,
        handleSaveProfile, handleExport, handleDeleteAccount
    } = useSettings();

    const { isInstallable, promptInstall } = usePWAInstall();

    const [subTab, setSubTab] = useState('biometry');
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

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
        <div id="view-data" className="view-section active">
            <div className="sub-nav">
                <div className={`sub-nav-btn ${subTab === 'biometry' ? 'active' : ''}`} onClick={() => setSubTab('biometry')}>Biometria</div>
                <div className={`sub-nav-btn ${subTab === 'account' ? 'active' : ''}`} onClick={() => setSubTab('account')}>Account</div>
            </div>

            {subTab === 'biometry' && (
                <div className="settings-sub-view active">
                    <div className="card">
                        <h3>Dati Biometrici</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Utilizzati per il calcolo della massa grassa (US Navy).</p>
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Data di Nascita</label>
                            <input id="settings-dob" type="date" style={{ width: '100%', maxWidth: '100%' }} value={dob} onChange={e => setDob(e.target.value)} />
                        </div>
                        <div className="input-row">
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Altezza (cm)</label>
                                <input id="settings-height" type="number" placeholder="es. 180" value={height} onChange={e => setHeight(e.target.value)} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sesso</label>
                                <select value={gender} onChange={e => setGender(e.target.value)}>
                                    <option value="">Non Specificato</option>
                                    <option value="M">Uomo</option>
                                    <option value="F">Donna</option>
                                </select>
                            </div>
                        </div>
                        <button className="btn btn-primary" style={{ width: '100%', marginTop: '15px' }} onClick={handleSaveProfile}>
                            💾 Salva Profilo
                        </button>
                    </div>

                    {isInstallable && (
                        <div style={{ marginTop: '20px', marginBottom: '20px' }}>
                            <button className="btn btn-primary" style={{ width: '100%', marginBottom: '15px' }} onClick={promptInstall}>
                                📱 Installa App sul Telefono
                            </button>
                        </div>
                    )}
                </div>
            )}

            {subTab === 'account' && (
                <div className="settings-sub-view active">
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

                    <div style={{ marginTop: '20px', marginBottom: '20px' }}>
                        <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%' }} onClick={handleExport}>
                            💾 Esporta Dati (CSV)
                        </button>
                    </div>

                    {isOffline && (
                        <div className="card" style={{ border: '1px solid var(--warning-color)', marginBottom: '15px', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                            <h3 style={{ color: 'var(--warning-color)' }}>⚠️ Connessione Assente</h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', margin: 0 }}>
                                Sei attualmente offline. Puoi continuare a usare l'app: tutte le modifiche verranno salvate localmente e sincronizzate con il cloud non appena tornerà la connessione.
                            </p>
                        </div>
                    )}

                    {/* Danger Zone */}
                    <div className="card" style={{ border: '1px solid var(--danger-color)', marginBottom: '100px' }}>
                        <h3 style={{ color: 'var(--danger-color)' }}>⚠️ Zona Pericolosa</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                            Elimina permanentemente il tuo account e tutti i dati associati. Questa azione è irreversibile.
                        </p>
                        <button 
                            className="btn" 
                            style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger-color)', border: '1px solid var(--danger-color)', width: '100%' }}
                            onClick={handleDeleteAccount}
                            disabled={deletingAccount}
                        >
                            {deletingAccount ? '⏳ Eliminazione...' : '🗑️ Elimina Account e Dati'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SettingsView;
