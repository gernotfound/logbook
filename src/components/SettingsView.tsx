import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAuth } from '../hooks/useAuth';
import { useDialogStore } from '../store/useDialogStore';
import { PrivacyPolicy } from '../pages/PrivacyPolicy';
import { TermsAndConditions } from '../pages/TermsAndConditions';
import { getAnalyticsConsent, setAnalyticsConsent } from '../lib/analyticsConsent';
import type { ExportSelection } from './ExportSelector';
import { AccountSettingsTab } from './Settings/AccountSettingsTab';
import { PrivacySettingsTab } from './Settings/PrivacySettingsTab';
import { ExportSettingsTab } from './Settings/ExportSettingsTab';
import SubNav from './UI/SubNav';
import { useAppearanceStore, type ThemePreference } from '../store/useAppearanceStore';
import './SettingsView.css';

type SettingsTab = 'account' | 'privacy' | 'export' | 'appearance';
const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
    { id: 'account', label: 'Account' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'export', label: 'Esporta' },
    { id: 'appearance', label: 'Aspetto' },
];
const APPEARANCE_OPTIONS: readonly { id: ThemePreference; label: string }[] = [
    { id: 'system', label: 'Sistema' },
    { id: 'light', label: 'Chiaro' },
    { id: 'dark', label: 'Scuro' },
];

const SettingsView = () => {
    const {
        deletingAccount, pendingAccountDeletion,
        handleExportCSV, handleExportShare, handleExportBackup, handleImportFile, importingData, exportingData,
        handleDeleteAccount
    } = useSettings();

    const { isGuest } = useAuth();
    const { isInstallable, isIOSInstallable, promptInstall } = usePWAInstall();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showTerms, setShowTerms] = useState(false);
    const [analyticsEnabled, setAnalyticsEnabled] = useState(getAnalyticsConsent());
    const [activeTab, setActiveTab] = useState<SettingsTab>('account');
    const appearance = useAppearanceStore(state => state.preference);
    const setAppearance = useAppearanceStore(state => state.setPreference);
    const [appearanceNotSaved, setAppearanceNotSaved] = useState(false);
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
                    if (reg.waiting) {
                        window.dispatchEvent(new Event('logbook:pwa-update-waiting'));
                    }
                    useDialogStore.getState().showAlert("Controllo aggiornamenti completato. Se è disponibile una nuova versione, il banner di aggiornamento comparirà in basso.");
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
            <SubNav id="settings" label="Sotto-menu Impostazioni" items={SETTINGS_TABS} value={activeTab} onChange={setActiveTab} />

            {activeTab === 'account' && (
                <div id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account">
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
                </div>
            )}

            {activeTab === 'privacy' && (
                <div id="settings-panel-privacy" role="tabpanel" aria-labelledby="settings-tab-privacy">
                <PrivacySettingsTab
                    analyticsEnabled={analyticsEnabled}
                    onOpenTerms={() => setShowTerms(true)}
                    onOpenPrivacy={() => setShowPrivacy(true)}
                    onToggleAnalytics={handleAnalyticsToggle}
                />
                </div>
            )}

            {activeTab === 'export' && (
                <div id="settings-panel-export" role="tabpanel" aria-labelledby="settings-tab-export">
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
                    onExportCSV={handleExportCSV}
                    onImportFile={handleImportFile}
                    importingData={importingData}
                    exportingData={exportingData}
                />
                </div>
            )}

            {activeTab === 'appearance' && (
                <section id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" className="settings-group">
                    <h2>Aspetto</h2>
                    <p className="settings-help">Scegli il tema di questo dispositivo. La scelta non modifica i dati del tuo account.</p>
                    <fieldset className="appearance-options" aria-label="Tema dell'app">
                        {APPEARANCE_OPTIONS.map(option => (
                            <label key={option.id} className={`appearance-option ${appearance === option.id ? 'is-selected' : ''}`}>
                                <input
                                    type="radio"
                                    name="appearance"
                                    value={option.id}
                                    checked={appearance === option.id}
                                    onChange={() => setAppearanceNotSaved(!setAppearance(option.id))}
                                />
                                {option.label}
                            </label>
                        ))}
                    </fieldset>
                    {appearanceNotSaved && <p role="status" className="settings-help settings-help-last">Il tema è attivo ora, ma il browser non ha potuto conservarlo per i prossimi avvii.</p>}
                </section>
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
