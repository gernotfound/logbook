import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleUserRound, DatabaseBackup, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useSettings } from '../hooks/useSettings';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../lib/firebase';
import { withdrawGuestHealthConsent, withdrawHealthConsent } from '../lib/healthConsent';
import { useDialogStore } from '../store/useDialogStore';
import BrandLoadingScreen from './UI/BrandLoadingScreen';
import { PrivacyPolicy } from '../pages/PrivacyPolicy';
import { TermsAndConditions } from '../pages/TermsAndConditions';
import type { ExportSelection } from './ExportSelector';
import { AccountSettingsTab } from './Settings/AccountSettingsTab';
import { PrivacySettingsTab } from './Settings/PrivacySettingsTab';
import { ApplicationSettingsTab } from './Settings/ApplicationSettingsTab';
import { ExportSettingsTab } from './Settings/ExportSettingsTab';
import { useAppearanceStore } from '../store/useAppearanceStore';
import { checkForWaitingServiceWorker } from '../lib/pwaUpdate';
import './SettingsView.css';

type SettingsSection = 'account' | 'privacy' | 'data' | 'application';

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
    const { isGuest, logout } = useAuth();
    const { isInstallable, isIOSInstallable, promptInstall } = usePWAInstall();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showTerms, setShowTerms] = useState(false);
    const [showWithdrawalOptions, setShowWithdrawalOptions] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
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

    const handleWithdrawHealthConsent = async () => {
        if (withdrawing) return;
        const user = auth.currentUser;
        if (!isGuest && !user) return;
        setWithdrawing(true);
        try {
            if (isGuest) {
                withdrawGuestHealthConsent();
                useAppStore.getState().cancelPendingSyncs();
                // Guest mode has no cloud archive: the existing forced logout
                // removes only its own device-scoped data and keys.
                await logout({ mode: 'force', skipConfirm: true });
            } else if (user) {
                await withdrawHealthConsent(user, () => useAppStore.getState().cancelPendingSyncs());
            }
            setShowWithdrawalOptions(false);
        } catch {
            await useDialogStore.getState().showAlert(
                isGuest
                    ? 'Il consenso è stato revocato localmente, ma la pulizia del dispositivo non è stata completata. Riprova la cancellazione dal pannello sospeso.'
                    : 'Le funzioni fitness sono state bloccate. La revoca o la cancellazione cloud non sono ancora confermate; il server riprenderà l’operazione se già registrata. Verifica lo stato quando torni online.',
            );
        } finally {
            setWithdrawing(false);
        }
    };

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
                            <span className="settings-row-copy"><strong>Privacy</strong><small>Consensi e informative</small></span>
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
                <AccountSettingsTab pendingAccountDeletion={pendingAccountDeletion} deletingAccount={deletingAccount} onDeleteAccount={handleDeleteAccount} />
            )}

            {activeSection === 'privacy' && (
                <>
                    <PrivacySettingsTab onOpenTerms={() => setShowTerms(true)} onOpenPrivacy={() => setShowPrivacy(true)} onWithdrawHealthConsent={() => setShowWithdrawalOptions(true)} />
                    {showWithdrawalOptions && (
                        <section className="settings-detail-card" aria-label="Conferma revoca del consenso">
                            <h2>Revoca del consenso e cancellazione dati</h2>
                            <p>La revoca sospende subito le funzioni fitness e avvia la cancellazione definitiva di allenamenti, nutrizione, misurazioni, profilo e bozze. Il tuo account di accesso rimane esistente. I dati cancellati non potranno essere ripristinati da TheLogBook.</p>
                            <p>Puoi esportare una copia prima di revocare il consenso. L’esportazione è facoltativa, può contenere informazioni sulla salute in chiaro e non impedisce la revoca anche se non riesce.</p>
                            <div className="settings-actions">
                                <button type="button" className="btn" disabled={withdrawing || exportingData} onClick={() => { void handleExportBackup(); }}>
                                    {exportingData ? 'Preparazione backup…' : 'Esporta prima i miei dati'}
                                </button>
                                <button type="button" className="btn btn-danger" disabled={withdrawing || exportingData} onClick={() => { void handleWithdrawHealthConsent(); }}>
                                    {withdrawing ? 'Revoca in corso…' : 'Revoca il consenso e cancella i dati'}
                                </button>
                                <button type="button" className="btn" disabled={withdrawing} onClick={() => setShowWithdrawalOptions(false)}>Annulla</button>
                            </div>
                        </section>
                    )}
                </>
            )}

            {activeSection === 'data' && (
                <ExportSettingsTab
                    library={storeLibrary} routines={storeRoutines} trainingCycles={storeCycles}
                    exportLibrary={exportLibrary} exportRoutines={exportRoutines} exportTrainingCycles={exportTrainingCycles}
                    onLibrarySelectionChange={setExportLibrary} onRoutinesSelectionChange={setExportRoutines} onTrainingCyclesSelectionChange={setExportTrainingCycles}
                    onExportShare={handleExportShare} onExportBackup={handleExportBackup} onExportCSV={handleExportCSV} onImportFile={handleImportFile}
                    importingData={importingData} exportingData={exportingData} isGuest={isGuest}
                />
            )}

            {activeSection === 'application' && (
                <ApplicationSettingsTab
                    appearance={appearance}
                    onAppearanceChange={preference => setAppearanceNotSaved(!setAppearance(preference))}
                    appearanceNotSaved={appearanceNotSaved}
                    isInstallable={isInstallable}
                    isIOSInstallable={isIOSInstallable}
                    onInstall={promptInstall}
                    isOffline={isOffline}
                    isGuest={isGuest}
                    checkingForUpdate={checkingForUpdate}
                    onCheckUpdate={handleCheckUpdate}
                />
            )}

            {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
            {showTerms && <TermsAndConditions onClose={() => setShowTerms(false)} />}
        </div>
    );
};
export default SettingsView;
