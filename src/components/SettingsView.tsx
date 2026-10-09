import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleUserRound, DatabaseBackup, RefreshCw, ShieldCheck, SlidersHorizontal, Smartphone, WifiOff } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAuth } from '../hooks/useAuth';
import { useDialogStore } from '../store/useDialogStore';
import BrandLoadingScreen from './UI/BrandLoadingScreen';
import { PrivacyPolicy } from '../pages/PrivacyPolicy';
import { TermsAndConditions } from '../pages/TermsAndConditions';
import { getAnalyticsConsent, setAnalyticsConsent, subscribeAnalyticsConsent } from '../lib/analyticsConsent';
import { requestHealthConsentRevocation } from '../lib/requestHealthConsentRevocation';
import { readHealthConsentRevocation } from '../lib/healthConsentRevocation';
import { captureSession } from '../lib/sync/session';
import type { ExportSelection } from './ExportSelector';
import { AccountSettingsTab } from './Settings/AccountSettingsTab';
import { StorageDiagnostics } from './Settings/StorageDiagnostics';
import { PrivacySettingsTab } from './Settings/PrivacySettingsTab';
import { ExportSettingsTab } from './Settings/ExportSettingsTab';
import { useAppearanceStore, type ThemePreference } from '../store/useAppearanceStore';
import { checkForWaitingServiceWorker } from '../lib/pwaUpdate';
import './SettingsView.css';

type SettingsSection = 'account' | 'privacy' | 'data' | 'application';

const APPEARANCE_OPTIONS: readonly { id: ThemePreference; label: string }[] = [
    { id: 'system', label: 'Sistema' },
    { id: 'light', label: 'Chiaro' },
    { id: 'dark', label: 'Scuro' },
];

const SECTION_TITLES: Record<SettingsSection, string> = {
    account: 'Account e accesso',
    privacy: 'Privacy',
    data: 'Dati e backup',
    application: 'Aspetto e applicazione',
};

interface SettingsViewProps { onClose?: () => void; }

const SettingsView = ({ onClose }: SettingsViewProps) => {
    const {
        deletingAccount, deletionPhase, pendingAccountDeletion,
        handleExportCSV, handleExportShare, handleExportBackup, handleImportFile, importingData, exportingData,
        handleDeleteAccount
    } = useSettings();
    const { isGuest } = useAuth();
    const { isInstallable, isIOSInstallable, promptInstall } = usePWAInstall();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showTerms, setShowTerms] = useState(false);
    const [analyticsEnabled, setAnalyticsEnabled] = useState(getAnalyticsConsent());
    const [revokingHealthConsent, setRevokingHealthConsent] = useState(false);
    const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);
    const appearance = useAppearanceStore(state => state.preference);
    const setAppearance = useAppearanceStore(state => state.setPreference);
    const [appearanceNotSaved, setAppearanceNotSaved] = useState(false);
    const [checkingForUpdate, setCheckingForUpdate] = useState(false);
    const [exportLibrary, setExportLibrary] = useState<ExportSelection>('all');
    const [exportRoutines, setExportRoutines] = useState<ExportSelection>('all');
    const [exportTrainingCycles, setExportTrainingCycles] = useState<ExportSelection>('all');
    const storeLibrary = useAppStore(state => state.userData?.library);
    const storeRoutines = useAppStore(state => state.userData?.routines);
    const storeCycles = useAppStore(state => state.userData?.trainingCycles);

    useEffect(() => subscribeAnalyticsConsent(setAnalyticsEnabled), []);

    const handleRevokeHealthConsent = async () => {
        if (revokingHealthConsent) return;
        const confirmed = await useDialogStore.getState().showConfirm(
            "Revocare il consenso ai dati salute?\n\nLe funzioni di allenamento, alimentazione e misurazioni saranno sospese. I dati di tracciamento senza altra base valida verranno eliminati: l'operazione è irreversibile e non elimina l'account. Se desideri una copia, scegli Annulla e usa «Esporta backup prima della revoca». La copia è facoltativa e non impedisce di revocare il consenso."
        );
        if (!confirmed) return;
        setRevokingHealthConsent(true);
        try {
            await requestHealthConsentRevocation();
        } catch {
            let locallySuspended = false;
            try {
                locallySuspended = readHealthConsentRevocation(captureSession().owner) !== 'none';
            } catch {
                // An unreadable security marker is not evidence of a saved request.
            }
            await useDialogStore.getState().showAlert(locallySuspended
                ? 'La revoca è salvata su questo dispositivo, ma la conferma del server è ancora in attesa. Riprova dalla schermata di sospensione.'
                : 'Non è stato possibile salvare la richiesta di revoca su questo dispositivo. Nessuna conferma è stata ricevuta; riprova quando la memoria locale sarà disponibile.');
        } finally {
            setRevokingHealthConsent(false);
        }
    };

    const handleAnalyticsToggle = () => {
        const newState = !analyticsEnabled;
        setAnalyticsEnabled(newState);
        setAnalyticsConsent(newState);
    };

    const handleCheckUpdate = async () => {
        if (checkingForUpdate) return;
        if (!('serviceWorker' in navigator)) {
            await useDialogStore.getState().showAlert("Il tuo browser non supporta gli aggiornamenti in background.");
            return;
        }

        setCheckingForUpdate(true);
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) {
                await useDialogStore.getState().showAlert("Nessun Service Worker trovato. Assicurati che l'app sia installata correttamente.");
                return;
            }

            const updateWaiting = await checkForWaitingServiceWorker(reg);

            if (updateWaiting) {
                window.dispatchEvent(new Event('logbook:pwa-update-waiting'));
                await useDialogStore.getState().showAlert("Nuova versione trovata. Usa il banner in basso per aggiornare TheLogBook in sicurezza.");
                return;
            }

            await useDialogStore.getState().showAlert("Controllo completato. TheLogBook è aggiornato.");
        } catch {
            await useDialogStore.getState().showAlert("Errore durante il controllo degli aggiornamenti.");
        } finally {
            setCheckingForUpdate(false);
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

    const handleBack = () => {
        if (activeSection) {
            setActiveSection(null);
            return;
        }
        if (onClose) {
            onClose();
            return;
        }
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'home' }));
    };

    const headerTitle = activeSection ? SECTION_TITLES[activeSection] : 'Impostazioni';

    if (deletingAccount && deletionPhase !== 'idle') {
        return (
            <div className="settings-account-deletion-progress" role="status" aria-live="polite" aria-busy="true">
                <BrandLoadingScreen
                    variant="content"
                    label={deletionPhase === 'verifying' ? 'Verifica identità in corso' : 'Eliminazione account in corso'}
                />
                <div className="settings-account-deletion-progress__copy">
                    <h1>{deletionPhase === 'verifying' ? 'Verifica identità…' : 'Eliminazione account…'}</h1>
                    <p>
                        {deletionPhase === 'verifying'
                            ? 'Stiamo completando la verifica di sicurezza.'
                            : 'Stiamo eliminando il tuo account e i dati associati. Attendi qualche secondo e non chiudere TheLogBook.'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div id="view-settings" className="view-section active settings-view">
            <header className="settings-header">
                <button type="button" className="settings-back-button" onClick={handleBack} aria-label={activeSection ? 'Torna alle impostazioni' : 'Torna alla Home'}>
                    <ChevronLeft size={24} aria-hidden="true" />
                </button>
                <div className="settings-header-copy">
                    <p className="settings-eyebrow">{activeSection ? 'Impostazioni' : 'Home'}</p>
                    <h1>{headerTitle}</h1>
                </div>
            </header>

            {!activeSection && (
                <>
                    <section className="settings-menu" aria-label="Sezioni delle impostazioni">
                        <button type="button" className="settings-menu-row" onClick={() => setActiveSection('account')}>
                            <span className="settings-row-icon"><CircleUserRound size={22} aria-hidden="true" /></span>
                            <span className="settings-row-copy"><strong>Account e accesso</strong><small>Profilo, sincronizzazione e sicurezza</small></span>
                            <ChevronRight size={20} aria-hidden="true" />
                        </button>
                        <button type="button" className="settings-menu-row" onClick={() => setActiveSection('privacy')}>
                            <span className="settings-row-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
                            <span className="settings-row-copy"><strong>Privacy</strong><small>Analytics, consensi e informative</small></span>
                            <ChevronRight size={20} aria-hidden="true" />
                        </button>
                        <button type="button" className="settings-menu-row" onClick={() => setActiveSection('data')}>
                            <span className="settings-row-icon"><DatabaseBackup size={22} aria-hidden="true" /></span>
                            <span className="settings-row-copy"><strong>Dati e backup</strong><small>Esporta, importa e condividi i dati</small></span>
                            <ChevronRight size={20} aria-hidden="true" />
                        </button>
                        <button type="button" className="settings-menu-row" onClick={() => setActiveSection('application')}>
                            <span className="settings-row-icon"><SlidersHorizontal size={22} aria-hidden="true" /></span>
                            <span className="settings-row-copy"><strong>Aspetto e applicazione</strong><small>Tema, installazione, aggiornamenti e diagnostica</small></span>
                            <ChevronRight size={20} aria-hidden="true" />
                        </button>
                    </section>
                </>
            )}

            {activeSection === 'account' && (
                <AccountSettingsTab pendingAccountDeletion={pendingAccountDeletion} isGuest={isGuest} deletingAccount={deletingAccount} onDeleteAccount={handleDeleteAccount} />
            )}

            {activeSection === 'privacy' && (
                <PrivacySettingsTab analyticsEnabled={analyticsEnabled} onOpenTerms={() => setShowTerms(true)} onOpenPrivacy={() => setShowPrivacy(true)} onToggleAnalytics={handleAnalyticsToggle} onRevokeHealthConsent={() => { void handleRevokeHealthConsent(); }} onExportBackup={() => { void handleExportBackup(); }} exportingData={exportingData} revokingHealthConsent={revokingHealthConsent} />
            )}

            {activeSection === 'data' && (
                <ExportSettingsTab
                    library={storeLibrary} routines={storeRoutines} trainingCycles={storeCycles}
                    exportLibrary={exportLibrary} exportRoutines={exportRoutines} exportTrainingCycles={exportTrainingCycles}
                    onLibrarySelectionChange={setExportLibrary} onRoutinesSelectionChange={setExportRoutines} onTrainingCyclesSelectionChange={setExportTrainingCycles}
                    onExportShare={handleExportShare} onExportBackup={handleExportBackup} onExportCSV={handleExportCSV} onImportFile={handleImportFile}
                    importingData={importingData} exportingData={exportingData}
                />
            )}

            {activeSection === 'application' && (
                <section className="settings-detail-stack" aria-label="Aspetto e applicazione">
                    <div className="settings-detail-card">
                        <h2>Tema</h2>
                        <fieldset className="appearance-options" aria-label="Tema dell'app">
                            {APPEARANCE_OPTIONS.map(option => (
                                <label key={option.id} className={'appearance-option ' + (appearance === option.id ? 'is-selected' : '')}>
                                    <input type="radio" name="appearance" value={option.id} checked={appearance === option.id} onChange={() => setAppearanceNotSaved(!setAppearance(option.id))} />
                                    {option.label}
                                </label>
                            ))}
                        </fieldset>
                        {appearanceNotSaved && <p role="status" className="settings-help settings-help-last">Il tema è attivo ora, ma il browser non ha potuto conservarlo per i prossimi avvii.</p>}
                    </div>

                    {isInstallable && (
                        <div className="settings-detail-card">
                            <h2><Smartphone size={20} aria-hidden="true" /> Installa TheLogBook</h2>
                            <p className="settings-help">Aggiungi TheLogBook al dispositivo per usarlo come un'app.</p>
                            <button type="button" className="btn btn-primary settings-full" onClick={promptInstall}>Installa app sul telefono</button>
                        </div>
                    )}
                    {isIOSInstallable && (
                        <div className="settings-detail-card">
                            <h2><Smartphone size={20} aria-hidden="true" /> Installa su iPhone o iPad</h2>
                            <p className="settings-help settings-help-last">In Safari tocca Condividi e poi “Aggiungi alla schermata Home”.</p>
                        </div>
                    )}
                    {isOffline && (
                        <div className="settings-detail-card settings-offline-card" role="status">
                            <h2><WifiOff size={20} aria-hidden="true" /> Connessione assente</h2>
                            <p className="settings-help settings-help-last">Puoi continuare a usare TheLogBook: le modifiche restano sul dispositivo e verranno sincronizzate quando tornerà la connessione.</p>
                        </div>
                    )}

                    <div className="settings-detail-list">
                        <button type="button" className="settings-simple-row" onClick={handleCheckUpdate} disabled={checkingForUpdate} aria-busy={checkingForUpdate}>
                            <span className="settings-row-copy"><strong>{checkingForUpdate ? 'Controllo aggiornamenti…' : 'Cerca aggiornamenti'}</strong><small>{checkingForUpdate ? 'Verifica della nuova versione in corso' : 'Controlla se è disponibile una nuova versione'}</small></span>
                            <RefreshCw size={20} aria-hidden="true" />
                        </button>
                    </div>
                    <StorageDiagnostics />
                    <p className="settings-version">Versione {__APP_VERSION__} · build {__BUILD_HASH__} · {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(__BUILD_TIME__))}</p>
                </section>
            )}

            {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
            {showTerms && <TermsAndConditions onClose={() => setShowTerms(false)} />}
        </div>
    );
};
export default SettingsView;
