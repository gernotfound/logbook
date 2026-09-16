import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAuth } from '../hooks/useAuth';
import { useDialogStore } from '../store/useDialogStore';
import { PrivacyPolicy } from '../pages/PrivacyPolicy';
import { TermsAndConditions } from '../pages/TermsAndConditions';
import { getAnalyticsConsent, setAnalyticsConsent } from '../lib/firebase';
import type { ExportSelection } from './ExportSelector';
import { AccountSettingsTab } from './Settings/AccountSettingsTab';
import { PrivacySettingsTab } from './Settings/PrivacySettingsTab';
import { ExportSettingsTab } from './Settings/ExportSettingsTab';

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
                <AccountSettingsTab
                    pendingAccountDeletion={pendingAccountDeletion}
                    isInstallable={isInstallable}
                    isIOSInstallable={isIOSInstallable}
                    isOffline={isOffline}
                    isGuest={isGuest}
                    deletingAccount={deletingAccount}
                    onPromptInstall={promptInstall}
                    onCheckUpdate={handleCheckUpdate}
                    onDeleteAccount={handleDeleteAccount}
                />
            )}

            {activeTab === 'privacy' && (
                <PrivacySettingsTab
                    analyticsEnabled={analyticsEnabled}
                    onOpenTerms={() => setShowTerms(true)}
                    onOpenPrivacy={() => setShowPrivacy(true)}
                    onToggleAnalytics={handleAnalyticsToggle}
                />
            )}

            {activeTab === 'export' && (
                <ExportSettingsTab
                    library={storeLibrary}
                    routines={storeRoutines}
                    trainingCycles={storeCycles}
                    exportLibrary={exportLibrary}
                    exportRoutines={exportRoutines}
                    exportTrainingCycles={exportTrainingCycles}
                    onLibrarySelectionChange={setExportLibrary}
                    onRoutinesSelectionChange={setExportRoutines}
                    onTrainingCyclesSelectionChange={setExportTrainingCycles}
                    onExportShare={handleExportShare}
                    onExportBackup={handleExportBackup}
                    onExportRecovery={handleExportRecovery}
                    onExportCSV={handleExportCSV}
                    onImportFile={handleImportFile}
                    importingData={importingData}
                    exportingData={exportingData}
                />
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
