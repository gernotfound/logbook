import { useState, useEffect } from 'react';
import { Trash2, Save, Palette, Download, RefreshCw, Shield, FileText, Upload, Database } from 'lucide-react';
import { useAppearanceStore, type ThemePreference } from '../store/useAppearanceStore';
import SubNav from './UI/SubNav';
import './SettingsView.css';
import { useAppStore } from '../store/useAppStore';

import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAuth } from '../hooks/useAuth';
import { useDialogStore } from '../store/useDialogStore';
import { PrivacyPolicy } from '../pages/PrivacyPolicy';
import { TermsAndConditions } from '../pages/TermsAndConditions';
import { setAnalyticsConsent, getAnalyticsConsent } from '../lib/firebase';
import { getStorageDiagnosticData } from '../lib/storageStatus';
import { AccountCard } from './UI/AccountCard';
import { ExportSelector, type ExportSelection, type ExportSelectorItem } from './ExportSelector';

const EMPTY_EXPORT_ITEMS: ExportSelectorItem[] = [];
const SETTINGS_TABS = [{ id: 'account', label: 'Account' }, { id: 'privacy', label: 'Privacy' }, { id: 'export', label: 'Esporta' }] as const;
const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [{ value: 'system', label: 'Sistema' }, { value: 'light', label: 'Chiaro' }, { value: 'dark', label: 'Scuro' }];

const SettingsView = () => {
    const {
        deletingAccount, pendingAccountDeletion,
        handleExportCSV, handleExportShare, handleExportBackup, handleExportRecovery, handleImportFile, importingData, exportingData,
        handleDeleteAccount
    } = useSettings();

    const { isGuest } = useAuth();
    const themePreference = useAppearanceStore(state => state.preference);
    const setThemePreference = useAppearanceStore(state => state.setPreference);
    const [themeStorageOk, setThemeStorageOk] = useState(true);
    const { isInstallable, isIOSInstallable, promptInstall } = usePWAInstall();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showTerms, setShowTerms] = useState(false);
    const [analyticsEnabled, setAnalyticsEnabled] = useState(getAnalyticsConsent());

    const [activeTab, setActiveTab] = useState<'account' | 'privacy' | 'export'>('account');

    const [exportLibrary, setExportLibrary] = useState<ExportSelection>('all');
    const [exportRoutines, setExportRoutines] = useState<ExportSelection>('all');
    const [exportTrainingCycles, setExportTrainingCycles] = useState<ExportSelection>('all');

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
        <div id="view-settings" className="view-section active settings-view">
            <h1 className="settings-title">Impostazioni</h1>
            <SubNav id="settings" label="Sotto-menu Impostazioni" items={SETTINGS_TABS} value={activeTab} onChange={setActiveTab} />
            {activeTab === 'account' && (
                <div role="tabpanel" id="settings-panel-account" aria-labelledby="settings-tab-account" tabIndex={0} className="settings-stack">
                    <section className="settings-group" aria-labelledby="appearance-heading">
                        <h2 id="appearance-heading"><Palette size={20} aria-hidden="true" /> Aspetto</h2>
                        <p className="settings-help">Scegli il tema di LogBook su questo dispositivo.</p>
                        <fieldset className="appearance-options">
                            <legend className="sr-only">Tema</legend>
                            {THEME_OPTIONS.map(option => (
                                <label key={option.value} className={`appearance-option ${themePreference === option.value ? 'is-selected' : ''}`}>
                                    <input type="radio" name="appearance" value={option.value} checked={themePreference === option.value} onChange={() => setThemeStorageOk(setThemePreference(option.value))} />
                                    <span>{option.label}</span>
                                </label>
                            ))}
                        </fieldset>
                        <p className="settings-help settings-help-last">Sistema segue l’aspetto impostato sul dispositivo.</p>
                        {!themeStorageOk && <p role="status" className="settings-warning text-sm">Tema applicato. Il browser non ha consentito di salvare la preferenza per il prossimo avvio.</p>}
                    </section>
                    <AccountCard />
                    {pendingAccountDeletion && <p role="alert" className="settings-warning">Cancellazione account da completare. La sincronizzazione è sospesa e la copia locale è conservata. Puoi esportare un backup e riprendere la cancellazione qui sotto.</p>}
                    <section className="settings-group">
                        <h2>App e aggiornamenti</h2>
                        {isInstallable && <button type="button" className="btn btn-primary settings-full" onClick={promptInstall}><Download size={20} aria-hidden="true" /> Installa app sul telefono</button>}
                        {isIOSInstallable && <div className="settings-inset">
                            <h3>Installa su iPhone / iPad</h3>
                            <p className="settings-help">Per installare LogBook come app a schermo intero: tocca l'icona <strong>Condividi</strong> in Safari e seleziona <strong>"Aggiungi alla schermata Home"</strong>.</p>
                        </div>}
                        <button type="button" className="btn btn-secondary settings-full" onClick={handleCheckUpdate}><RefreshCw size={20} aria-hidden="true" /> Cerca aggiornamenti</button>
                    </section>
                    <section className="settings-group">
                        <h2><Database size={20} aria-hidden="true" /> Diagnostica archiviazione</h2>
                        <p className="settings-help">Stato della persistenza dei dati offline su questo dispositivo.</p>
                        {(() => {
                            const storageDiag = getStorageDiagnosticData();
                            if (!storageDiag) return <p className="settings-help">Caricamento...</p>;
                            if (!storageDiag.supported) return <p className="settings-danger text-sm">Persistenza non supportata (Storage API mancante).</p>;
                            return <dl className="settings-details">
                                <div><dt>Stato</dt><dd className={storageDiag.persistent ? 'settings-success' : 'settings-warning'}>{storageDiag.persistent ? 'Persistente (Sicuro)' : 'Best-Effort (Volatile)'}</dd></div>
                                {storageDiag.usage !== undefined && storageDiag.quota !== undefined && <div><dt>Utilizzo</dt><dd>{(storageDiag.usage / 1024 / 1024).toFixed(2)} MB / {(storageDiag.quota / 1024 / 1024).toFixed(2)} MB</dd></div>}
                            </dl>;
                        })()}
                    </section>
                    {isOffline && <section className="settings-group">
                        <h2 className="settings-warning">Connessione assente</h2>
                        <p className="settings-help">Sei attualmente offline. Puoi continuare a usare l'app: tutte le modifiche verranno salvate localmente e sincronizzate con il cloud non appena tornerà la connessione.</p>
                    </section>}
                    <section className="settings-group settings-group-danger">
                        <h2 className="settings-danger">Zona pericolosa</h2>
                        <p className="settings-help">{isGuest ? "Elimina permanentemente tutti i dati salvati su questo dispositivo. Questa azione è irreversibile." : "Elimina permanentemente il tuo account e tutti i dati associati. Questa azione è irreversibile."}</p>
                        <button type="button" className="btn settings-danger-button settings-full" onClick={handleDeleteAccount} disabled={deletingAccount}>
                            <Trash2 size={20} aria-hidden="true" /> {deletingAccount ? 'Eliminazione...' : isGuest ? 'Elimina dati locali' : pendingAccountDeletion ? 'Riprendi cancellazione account' : 'Elimina account e dati'}
                        </button>
                    </section>
                </div>
            )}
            {activeTab === 'privacy' && (
                <div role="tabpanel" id="settings-panel-privacy" aria-labelledby="settings-tab-privacy" tabIndex={0} className="settings-stack">
                    <section className="settings-group">
                        <h2><Shield size={20} aria-hidden="true" /> Legale e privacy</h2>
                        <div className="settings-stack">
                            <button type="button" className="btn btn-secondary settings-full" onClick={() => setShowTerms(true)}><FileText size={20} aria-hidden="true" /> Termini e condizioni</button>
                            <button type="button" className="btn btn-secondary settings-full" onClick={() => setShowPrivacy(true)}><FileText size={20} aria-hidden="true" /> Informativa sulla privacy</button>
                        </div>
                        <p className="settings-help settings-help-last">Titolare del trattamento: LogBook Developer<br />Email: privacy@logbook.example.com</p>
                    </section>
                    <section className="settings-group">
                        <label className="settings-toggle" htmlFor="analytics-toggle">
                            <span><span className="settings-label">Statistiche di utilizzo</span><span className="settings-help">Condividi dati anonimi di diagnostica e Analytics per aiutarci a migliorare l'app.</span></span>
                            <input type="checkbox" id="analytics-toggle" checked={analyticsEnabled} onChange={handleAnalyticsToggle} />
                        </label>
                    </section>
                </div>
            )}
            {activeTab === 'export' && (
                <div role="tabpanel" id="settings-panel-export" aria-labelledby="settings-tab-export" tabIndex={0} className="settings-stack">
                    <section className="settings-group">
                        <h2>Condividi con altri atleti</h2>
                        <p className="settings-help">Esporta o importa esercizi, schede e pianificazioni per condividerli.</p>
                        <ExportSelector title="Esercizi (Libreria)" items={storeLibrary || EMPTY_EXPORT_ITEMS} selection={exportLibrary} onChange={setExportLibrary} />
                        <ExportSelector title="Schede (Routines)" items={storeRoutines || EMPTY_EXPORT_ITEMS} selection={exportRoutines} onChange={setExportRoutines} />
                        <ExportSelector title="Pianificazioni (Cicli)" items={storeCycles || EMPTY_EXPORT_ITEMS} selection={exportTrainingCycles} onChange={setExportTrainingCycles} />
                        <div className="settings-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => handleExportShare({ exportLibrary: exportLibrary === 'all' ? true : exportLibrary === 'none' ? false : exportLibrary, exportRoutines: exportRoutines === 'all' ? true : exportRoutines === 'none' ? false : exportRoutines, exportTrainingCycles: exportTrainingCycles === 'all' ? true : exportTrainingCycles === 'none' ? false : exportTrainingCycles })} disabled={exportLibrary === 'none' && exportRoutines === 'none' && exportTrainingCycles === 'none'}><Upload size={20} aria-hidden="true" /> Esporta JSON</button>
                            <label className={`btn btn-primary settings-file-button ${importingData ? 'is-disabled' : ''}`}><Download size={20} aria-hidden="true" /> {importingData ? 'Import...' : 'Importa JSON'}<input type="file" accept=".json" className="sr-only" aria-label="Importa JSON" onChange={handleImportFile} disabled={importingData} /></label>
                        </div>
                    </section>
                    <section className="settings-group">
                        <h2>Backup personale (solo tuo uso)</h2>
                        <p className="settings-help">Il backup legge tutto lo storico disponibile nel cloud e include la copia locale. Senza connessione puoi scegliere una copia parziale del dispositivo.</p>
                        <p className="settings-help">“Importa JSON” aggiunge i dati mancanti. “Ripristina” sostituisce i campi presenti nel file, dopo un’anteprima. Le modifiche su altri dispositivi durante l’esportazione possono richiedere un nuovo backup.</p>
                        <p className="settings-warning text-sm">L'importazione da altri utenti non ripristinerà cronologie personali per sicurezza.</p>
                        <div className="settings-actions">
                            <button type="button" className="btn btn-secondary" onClick={handleExportBackup} disabled={exportingData}><Upload size={20} aria-hidden="true" /> {exportingData ? 'Preparazione backup…' : 'Backup JSON'}</button>
                            <label className={`btn btn-primary settings-file-button ${importingData ? 'is-disabled' : ''}`}><Download size={20} aria-hidden="true" /> {importingData ? 'Import...' : 'Ripristina'}<input type="file" accept=".json" className="sr-only" aria-label="Ripristina" onChange={event => handleImportFile(event, 'restore')} disabled={importingData} /></label>
                        </div>
                        <button type="button" className="btn btn-secondary settings-full settings-recovery" onClick={handleExportRecovery}>Esporta archivio precedente</button>
                    </section>
                    <section className="settings-group">
                        <h2>Esportazione legacy</h2>
                        <button type="button" className="btn btn-secondary settings-full" onClick={handleExportCSV}><Save size={20} aria-hidden="true" /> Esporta dati (CSV)</button>
                    </section>
                    <p className="settings-version text-sm">Versione {__APP_VERSION__} &middot; build {__BUILD_HASH__} &middot; {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(__BUILD_TIME__))}</p>
                </div>
            )}
            {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
            {showTerms && <TermsAndConditions onClose={() => setShowTerms(false)} />}
        </div>
    );
};

export default SettingsView;
