import { useState, useEffect, useMemo } from 'react';
import Fuse from 'fuse.js';
import { useAppStore } from '../store/useAppStore';
import React from 'react';

import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAuth } from '../hooks/useAuth';
import { useDialogStore } from '../store/useDialogStore';
import { PrivacyPolicy } from '../pages/PrivacyPolicy';
import { TermsAndConditions } from '../pages/TermsAndConditions';
import { setAnalyticsConsent, getAnalyticsConsent } from '../lib/firebase';
import { getStorageDiagnosticData } from '../lib/storageStatus';
import { AccountCard } from './UI/AccountCard';


type ExportSelection = 'all' | 'none' | string[];

const ExportSelector = React.memo(({ 
    title, 
    items, 
    selection, 
    onChange 
}: { 
    title: string, 
    items: {id: string, name: string}[], 
    selection: ExportSelection, 
    onChange: (val: ExportSelection) => void 
}) => {
    const [searchQuery, setSearchQuery] = useState('');

    const fuse = useMemo(() => new Fuse(items, { keys: ['name'], threshold: 0.3 }), [items]);
    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return items;
        return fuse.search(searchQuery).map(res => res.item);
    }, [searchQuery, items, fuse]);

    const isCustom = Array.isArray(selection);

    return (
        <div style={{ marginBottom: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{title}</span>
                <select 
                    value={selection === 'all' ? 'all' : selection === 'none' ? 'none' : 'custom'}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'all') onChange('all');
                        else if (val === 'none') onChange('none');
                        else onChange([]);
                    }}
                    style={{ background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.85rem' }}
                >
                    <option value="all">Tutti ({items.length})</option>
                    <option value="custom">Seleziona...</option>
                    <option value="none">Nessuno</option>
                </select>
            </div>
            
            {isCustom && (
                <div style={{ border: '1px solid var(--glass-border)', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', padding: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {selection.length} selezionati su {items.length}
                        </span>
                        {items.length > 5 && (
                            <input 
                                type="text" 
                                placeholder="Cerca..." 
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                style={{ width: '120px', padding: '4px 8px', fontSize: '0.85rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '4px', color: 'var(--text-main)' }}
                            />
                        )}
                    </div>
                    
                    <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {filteredItems.length === 0 ? <span style={{fontSize: '0.85rem', color:'var(--text-muted)'}}>Nessun elemento</span> : filteredItems.map(item => (
                            <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                <input 
                                    type="checkbox" 
                                    checked={(selection as string[]).includes(item.id)}
                                    onChange={e => {
                                        if (e.target.checked) onChange([...(selection as string[]), item.id]);
                                        else onChange((selection as string[]).filter(id => id !== item.id));
                                    }}
                                    style={{ accentColor: 'var(--primary-color)' }}
                                />
                                {item.name}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

const SettingsView = () => {
    const {
        deletingAccount, pendingAccountDeletion,
        handleExportCSV, handleExportShare, handleExportBackup, handleExportRecovery, handleImportFile, importingData, exportingData,
        handleDeleteAccount
    } = useSettings();

    const { isGuest } = useAuth();
    const { isInstallable, isIOSInstallable, promptInstall } = usePWAInstall();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showTerms, setShowTerms] = useState(false);
    const [analyticsEnabled, setAnalyticsEnabled] = useState(getAnalyticsConsent());
    
    const [activeTab, setActiveTab] = useState<'account' | 'privacy' | 'export'>('account');

    const [exportLibrary, setExportLibrary] = useState<ExportSelection>('all');
    const [exportRoutines, setExportRoutines] = useState<ExportSelection>('all');
    const [exportTrainingCycles, setExportTrainingCycles] = useState<ExportSelection>('all');
    
    const EMPTY_ARRAY: any[] = [];
    const storeLibrary = useAppStore(state => state.userData?.library);
    const storeRoutines = useAppStore(state => state.userData?.routines);
    const storeCycles = useAppStore(state => state.userData?.trainingCycles);

    useEffect(() => {
        const handler = () => setAnalyticsEnabled(getAnalyticsConsent());
        window.addEventListener('analytics_consent_changed', handler);
        return () => window.removeEventListener('analytics_consent_changed', handler);
    }, []);

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
            } catch {
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
            <h1 style={{marginBottom: '15px'}}><span aria-hidden="true">⚙️</span> Impostazioni</h1>

            <div className="sub-nav" role="tablist" aria-label="Sotto-menu Impostazioni" style={{ marginBottom: '20px' }}>
                <button type="button" role="tab" aria-selected={activeTab === 'account'} className={`sub-nav-btn ${activeTab === 'account' ? 'active' : ''}`} onClick={() => setActiveTab('account')}>Account</button>
                <button type="button" role="tab" aria-selected={activeTab === 'privacy'} className={`sub-nav-btn ${activeTab === 'privacy' ? 'active' : ''}`} onClick={() => setActiveTab('privacy')}>Privacy</button>
                <button type="button" role="tab" aria-selected={activeTab === 'export'} className={`sub-nav-btn ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>Esporta</button>
            </div>

            {activeTab === 'account' && (
                <>
                    <AccountCard />
                    {pendingAccountDeletion && <p role="alert" style={{ color: 'var(--warning-color)' }}>Cancellazione account da completare. La sincronizzazione è sospesa e la copia locale è conservata. Puoi esportare un backup e riprendere la cancellazione qui sotto.</p>}

                    {isInstallable && (
                        <div className="section-divider">
                            <button className="btn btn-primary" style={{ width: '100%', marginBottom: 0 }} onClick={promptInstall}>
                                <span aria-hidden="true">📱</span> Installa app sul telefono
                            </button>
                        </div>
                    )}

                    {isIOSInstallable && (
                        <div className="section-divider">
                            <h3 style={{margin: '0 0 8px 0', color: 'var(--primary-color)'}}>
                                <span aria-hidden="true">📱</span> Installa su iPhone / iPad
                            </h3>
                            <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.4, color: 'var(--text-main)' }}>
                                Per installare LogBook come app a schermo intero: tocca l'icona <strong>Condividi</strong> in Safari e seleziona <strong>"Aggiungi alla schermata Home"</strong>.
                            </p>
                        </div>
                    )}

                    <div className="section-divider">
                        <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', marginBottom: 0 }} onClick={handleCheckUpdate}>
                            <span aria-hidden="true">🔄</span> Cerca aggiornamenti
                        </button>
                    </div>

                    <div className="section-divider">
                        <h3 style={{margin: '0 0 10px 0'}}><span aria-hidden="true">🔧</span> Diagnostica archiviazione</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 10px 0' }}>Stato della persistenza dei dati offline su questo dispositivo.</p>
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

                    {isOffline && (
                        <div className="section-divider">
                            <h2 style={{color: 'var(--warning-color)',marginTop: 0}}><span aria-hidden="true">⚠️</span> Connessione assente</h2>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', margin: 0 }}>
                                Sei attualmente offline. Puoi continuare a usare l'app: tutte le modifiche verranno salvate localmente e sincronizzate con il cloud non appena tornerà la connessione.
                            </p>
                        </div>
                    )}

                    {/* Danger Zone */}
                    <div className="card" style={{ marginBottom: '100px' }}>
                        <h2 style={{color: 'var(--danger-color)',marginTop: 0}}><span aria-hidden="true">⚠️</span> Zona pericolosa</h2>
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
                            {deletingAccount ? <><span aria-hidden="true">⏳</span> Eliminazione...</> : (isGuest ? <><span aria-hidden="true">🗑️</span> Elimina dati locali</> : <><span aria-hidden="true">🗑️</span> {pendingAccountDeletion ? 'Riprendi cancellazione account' : 'Elimina account e dati'}</>)}
                        </button>
                    </div>
                </>
            )}

            {activeTab === 'privacy' && (
                <>
                    <div className="section-divider" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <h3 style={{margin: '0 0 5px 0'}}><span aria-hidden="true">⚖️</span> Legale e Privacy</h3>
                        <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', margin: 0 }} onClick={() => setShowTerms(true)}>
                            <span aria-hidden="true">📄</span> Termini e Condizioni
                        </button>
                        <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', margin: 0 }} onClick={() => setShowPrivacy(true)}>
                            <span aria-hidden="true">📋</span> Informativa sulla Privacy
                        </button>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                            Titolare del trattamento: LogBook Developer<br/>
                            Email: privacy@logbook.example.com
                        </div>
                    </div>
                    
                    <div className="section-divider">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{margin: '0 0 5px 0',color: 'var(--text-main)'}}>Statistiche di utilizzo</h3>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Condividi dati anonimi di diagnostica e Analytics per aiutarci a migliorare l'app.</p>
                            </div>
                            <input type="checkbox" id="analytics-toggle" checked={analyticsEnabled} onChange={handleAnalyticsToggle} style={{ width: '24px', height: '24px', accentColor: 'var(--primary-color)', marginLeft: '10px' }} />
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'export' && (
                <>
                    <div className="section-divider">
                        <h3 style={{margin: '0 0 10px 0',color: 'var(--text-main)'}}><span aria-hidden="true">🤝</span> Condividi con altri atleti</h3>
                        <p style={{ margin: '0 0 15px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Esporta o importa Esercizi, Schede e Pianificazioni per condividerli.</p>
                        
                        <ExportSelector title="Esercizi (Libreria)" items={storeLibrary || EMPTY_ARRAY} selection={exportLibrary} onChange={setExportLibrary} />
                        <ExportSelector title="Schede (Routines)" items={storeRoutines || EMPTY_ARRAY} selection={exportRoutines} onChange={setExportRoutines} />
                        <ExportSelector title="Pianificazioni (Cicli)" items={storeCycles || EMPTY_ARRAY} selection={exportTrainingCycles} onChange={setExportTrainingCycles} />

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button 
                                className="btn" 
                                style={{ flex: 1, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', margin: 0, opacity: (exportLibrary === 'none' && exportRoutines === 'none' && exportTrainingCycles === 'none') ? 0.5 : 1 }} 
                                onClick={() => handleExportShare({ 
                                    exportLibrary: exportLibrary === 'all' ? true : exportLibrary === 'none' ? false : exportLibrary, 
                                    exportRoutines: exportRoutines === 'all' ? true : exportRoutines === 'none' ? false : exportRoutines, 
                                    exportTrainingCycles: exportTrainingCycles === 'all' ? true : exportTrainingCycles === 'none' ? false : exportTrainingCycles 
                                })}
                                disabled={exportLibrary === 'none' && exportRoutines === 'none' && exportTrainingCycles === 'none'}
                            >
                                <span aria-hidden="true">📤</span> Esporta JSON
                            </button>
                            <label className="btn btn-primary" style={{ flex: 1, margin: 0, textAlign: 'center', cursor: 'pointer', opacity: importingData ? 0.7 : 1 }}>
                                {importingData ? <span aria-hidden="true">⏳</span> : <span aria-hidden="true">📥</span>} {importingData ? 'Import...' : 'Importa JSON'}
                                <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} disabled={importingData} />
                            </label>
                        </div>
                    </div>

                    <div className="section-divider">
                        <h3 style={{margin: '0 0 10px 0',color: 'var(--text-main)'}}><span aria-hidden="true">🔐</span> Backup personale (solo tuo uso)</h3>
                        <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Il backup legge tutto lo storico disponibile nel cloud e include la copia locale. Senza connessione puoi scegliere una copia parziale del dispositivo.</p>
                        <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>“Importa JSON” aggiunge i dati mancanti. “Ripristina” sostituisce i campi presenti nel file, dopo un’anteprima. Le modifiche su altri dispositivi durante l’esportazione possono richiedere un nuovo backup.</p>
                        <p style={{ margin: '0 0 15px 0', fontSize: '0.75rem', color: 'var(--warning-color)' }}>L'importazione da altri utenti non ripristinerà cronologie personali per sicurezza.</p>
                        
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button className="btn" style={{ flex: 1, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', margin: 0 }} onClick={handleExportBackup} disabled={exportingData}>
                                <span aria-hidden="true">📤</span> {exportingData ? 'Preparazione backup…' : 'Backup JSON'}
                            </button>
                            <label className="btn btn-primary" style={{ flex: 1, margin: 0, textAlign: 'center', cursor: 'pointer', opacity: importingData ? 0.7 : 1 }}>
                                {importingData ? <span aria-hidden="true">⏳</span> : <span aria-hidden="true">📥</span>} {importingData ? 'Import...' : 'Ripristina'}
                                <input type="file" accept=".json" style={{ display: 'none' }} onChange={e => handleImportFile(e, 'restore')} disabled={importingData} />
                            </label>
                        </div>
                        <button className="btn" style={{ marginTop: '12px', minHeight: '44px' }} onClick={handleExportRecovery}>Esporta archivio precedente</button>
                    </div>

                    <div className="section-divider">
                        <h3 style={{margin: '0 0 10px 0',color: 'var(--text-main)'}}><span aria-hidden="true">📊</span> Esportazione Legacy</h3>
                        <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', marginBottom: 0 }} onClick={handleExportCSV}>
                            <span aria-hidden="true">💾</span> Esporta dati (CSV)
                        </button>
                    </div>

                    <div style={{ textAlign: 'center', marginTop: '30px', marginBottom: '10px' }}>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Versione {__APP_VERSION__} &middot; build {__BUILD_HASH__} &middot; {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(__BUILD_TIME__))}
                        </p>
                    </div>
                </>
            )}

            {showPrivacy && (
                <PrivacyPolicy onClose={() => setShowPrivacy(false)} />
            )}
            
            {showTerms && (
                <TermsAndConditions onClose={() => setShowTerms(false)} />
            )}
        </div>
    );
};

export default SettingsView;
