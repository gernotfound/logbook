import { useEffect, useState } from 'react';
import {
    AlertTriangle, Archive, BarChart3, DatabaseBackup, Download, FileSpreadsheet,
    FileText, HardDrive, LockKeyhole, RefreshCw, Settings2, Share2, ShieldCheck,
    Smartphone, Trash2, Upload, WifiOff
} from 'lucide-react';
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

const SettingsView = () => {
    const {
        deletingAccount, pendingAccountDeletion,
        handleExportCSV, handleExportShare, handleExportBackup, handleExportRecovery,
        handleImportFile, importingData, exportingData, handleDeleteAccount
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
    const storageDiag = getStorageDiagnosticData();

    useEffect(() => {
        const handler = () => setAnalyticsEnabled(getAnalyticsConsent());
        window.addEventListener('analytics_consent_changed', handler);
        return () => window.removeEventListener('analytics_consent_changed', handler);
    }, []);

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

    const handleAnalyticsToggle = () => {
        const newState = !analyticsEnabled;
        setAnalyticsEnabled(newState);
        setAnalyticsConsent(newState);
    };

    const handleCheckUpdate = async () => {
        if (!('serviceWorker' in navigator)) {
            useDialogStore.getState().showAlert('Il tuo browser non supporta gli aggiornamenti in background.');
            return;
        }
        try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                await registration.update();
                useDialogStore.getState().showAlert('Controllo aggiornamenti inviato. Se è disponibile una nuova versione, il banner di aggiornamento comparirà a breve in basso.');
            } else {
                useDialogStore.getState().showAlert("Nessun Service Worker trovato. Assicurati che l'app sia installata correttamente.");
            }
        } catch {
            useDialogStore.getState().showAlert('Errore durante il controllo degli aggiornamenti.');
        }
    };

    const nothingSelected = exportLibrary === 'none' && exportRoutines === 'none' && exportTrainingCycles === 'none';

    return (
        <div id="view-settings" className="view-section active settings-view">
            <header className="page-header settings-page-header">
                <div>
                    <span className="page-header__eyebrow">LogBook</span>
                    <h1 className="page-header__title">Impostazioni</h1>
                    <p className="page-header__description">Account, privacy, dati e strumenti della PWA in un unico posto.</p>
                </div>
                <div className="settings-page-header__icon" aria-hidden="true"><Settings2 size={21} /></div>
            </header>

            <div className="sub-nav" role="tablist" aria-label="Sotto-menu Impostazioni">
                <button type="button" role="tab" aria-selected={activeTab === 'account'} className={`sub-nav-btn ${activeTab === 'account' ? 'active' : ''}`} onClick={() => setActiveTab('account')}>Account</button>
                <button type="button" role="tab" aria-selected={activeTab === 'privacy'} className={`sub-nav-btn ${activeTab === 'privacy' ? 'active' : ''}`} onClick={() => setActiveTab('privacy')}>Privacy</button>
                <button type="button" role="tab" aria-selected={activeTab === 'export'} className={`sub-nav-btn ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>Esporta</button>
            </div>

            {activeTab === 'account' && (
                <div className="settings-stack">
                    <AccountCard />

                    {pendingAccountDeletion && (
                        <div className="settings-notice settings-notice--warning" role="alert">
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div><strong>Cancellazione da completare</strong><span>La sincronizzazione è sospesa e la copia locale è conservata. Puoi esportare un backup e riprendere la cancellazione qui sotto.</span></div>
                        </div>
                    )}

                    {(isInstallable || isIOSInstallable) && (
                        <section className="settings-group">
                            <div className="settings-group__heading">
                                <div className="settings-group__icon"><Smartphone size={18} /></div>
                                <div><h2>Installazione PWA</h2><p>Usa LogBook a schermo intero come un'app nativa.</p></div>
                            </div>
                            {isInstallable && (
                                <button className="btn btn-primary" type="button" onClick={promptInstall}><Smartphone size={18} /> Installa app sul telefono</button>
                            )}
                            {isIOSInstallable && (
                                <div className="settings-inline-info">Su iPhone o iPad, apri <strong>Condividi</strong> in Safari e scegli <strong>“Aggiungi alla schermata Home”</strong>.</div>
                            )}
                        </section>
                    )}

                    <section className="settings-group">
                        <div className="settings-row">
                            <div className="settings-row__icon"><RefreshCw size={18} /></div>
                            <div className="settings-row__content"><strong>Aggiornamenti</strong><span>Controlla subito se è disponibile una nuova versione della PWA.</span></div>
                            <button className="settings-row__action" type="button" onClick={handleCheckUpdate}>Controlla</button>
                        </div>
                    </section>

                    <section className="settings-group">
                        <div className="settings-group__heading">
                            <div className="settings-group__icon"><HardDrive size={18} /></div>
                            <div><h2>Archiviazione locale</h2><p>Diagnostica della persistenza offline di questo dispositivo.</p></div>
                        </div>
                        {!storageDiag ? (
                            <div className="settings-status-row"><span>Stato</span><strong>Caricamento...</strong></div>
                        ) : !storageDiag.supported ? (
                            <div className="settings-notice settings-notice--danger"><AlertTriangle size={18} /><div><strong>Persistenza non supportata</strong><span>La Storage API non è disponibile su questo browser.</span></div></div>
                        ) : (
                            <div className="settings-status-list">
                                <div className="settings-status-row"><span>Stato</span><strong className={storageDiag.persistent ? 'is-success' : 'is-warning'}>{storageDiag.persistent ? 'Persistente (sicuro)' : 'Best-effort (volatile)'}</strong></div>
                                {storageDiag.usage !== undefined && storageDiag.quota !== undefined && (
                                    <div className="settings-status-row"><span>Utilizzo</span><strong>{(storageDiag.usage / 1024 / 1024).toFixed(2)} MB / {(storageDiag.quota / 1024 / 1024).toFixed(2)} MB</strong></div>
                                )}
                            </div>
                        )}
                    </section>

                    {isOffline && (
                        <div className="settings-notice settings-notice--warning">
                            <WifiOff size={18} aria-hidden="true" />
                            <div><strong>Connessione assente</strong><span>Puoi continuare a usare l'app. Le modifiche restano locali e verranno sincronizzate quando tornerai online.</span></div>
                        </div>
                    )}

                    <section className="settings-group settings-danger-zone">
                        <div className="settings-group__heading">
                            <div className="settings-group__icon settings-group__icon--danger"><Trash2 size={18} /></div>
                            <div><h2>Zona pericolosa</h2><p>{isGuest ? 'Elimina permanentemente tutti i dati salvati su questo dispositivo.' : 'Elimina permanentemente il tuo account e tutti i dati associati.'}</p></div>
                        </div>
                        <button className="btn btn-danger" type="button" onClick={handleDeleteAccount} disabled={deletingAccount}>
                            <Trash2 size={18} /> {deletingAccount ? 'Eliminazione...' : (isGuest ? 'Elimina dati locali' : (pendingAccountDeletion ? 'Riprendi cancellazione account' : 'Elimina account e dati'))}
                        </button>
                    </section>
                </div>
            )}

            {activeTab === 'privacy' && (
                <div className="settings-stack">
                    <section className="settings-group">
                        <div className="settings-group__heading">
                            <div className="settings-group__icon"><ShieldCheck size={18} /></div>
                            <div><h2>Legale e privacy</h2><p>Documenti e informazioni sul trattamento dei dati.</p></div>
                        </div>
                        <div className="settings-action-list">
                            <button className="settings-row settings-row--button" type="button" onClick={() => setShowTerms(true)}>
                                <div className="settings-row__icon"><FileText size={18} /></div><div className="settings-row__content"><strong>Termini e condizioni</strong><span>Condizioni di utilizzo del servizio.</span></div><span className="settings-row__chevron">›</span>
                            </button>
                            <button className="settings-row settings-row--button" type="button" onClick={() => setShowPrivacy(true)}>
                                <div className="settings-row__icon"><LockKeyhole size={18} /></div><div className="settings-row__content"><strong>Informativa sulla privacy</strong><span>Come vengono trattati e protetti i tuoi dati.</span></div><span className="settings-row__chevron">›</span>
                            </button>
                        </div>
                        <div className="settings-inline-info">Titolare del trattamento: LogBook Developer · privacy@logbook.example.com</div>
                    </section>

                    <section className="settings-group">
                        <div className="settings-row settings-row--toggle">
                            <div className="settings-row__icon"><BarChart3 size={18} /></div>
                            <div className="settings-row__content"><strong>Statistiche di utilizzo</strong><span>Condividi diagnostica e Analytics anonimi per migliorare l'app.</span></div>
                            <label className="switch-control" aria-label="Statistiche di utilizzo">
                                <input type="checkbox" id="analytics-toggle" checked={analyticsEnabled} onChange={handleAnalyticsToggle} />
                                <span />
                            </label>
                        </div>
                    </section>
                </div>
            )}

            {activeTab === 'export' && (
                <div className="settings-stack">
                    <section className="settings-group">
                        <div className="settings-group__heading">
                            <div className="settings-group__icon"><Share2 size={18} /></div>
                            <div><h2>Condividi con altri atleti</h2><p>Esporta o importa esercizi, schede e pianificazioni selezionate.</p></div>
                        </div>
                        <ExportSelector title="Esercizi (Libreria)" items={storeLibrary || EMPTY_EXPORT_ITEMS} selection={exportLibrary} onChange={setExportLibrary} />
                        <ExportSelector title="Schede (Routines)" items={storeRoutines || EMPTY_EXPORT_ITEMS} selection={exportRoutines} onChange={setExportRoutines} />
                        <ExportSelector title="Pianificazioni (Cicli)" items={storeCycles || EMPTY_EXPORT_ITEMS} selection={exportTrainingCycles} onChange={setExportTrainingCycles} />
                        <div className="settings-button-grid">
                            <button
                                className="btn btn-secondary"
                                type="button"
                                onClick={() => handleExportShare({
                                    exportLibrary: exportLibrary === 'all' ? true : exportLibrary === 'none' ? false : exportLibrary,
                                    exportRoutines: exportRoutines === 'all' ? true : exportRoutines === 'none' ? false : exportRoutines,
                                    exportTrainingCycles: exportTrainingCycles === 'all' ? true : exportTrainingCycles === 'none' ? false : exportTrainingCycles
                                })}
                                disabled={nothingSelected}
                            ><Download size={18} /> Esporta JSON</button>
                            <label className={`btn btn-primary file-action ${importingData ? 'is-busy' : ''}`}>
                                <Upload size={18} /> {importingData ? 'Import...' : 'Importa JSON'}
                                <input type="file" accept=".json" onChange={handleImportFile} disabled={importingData} />
                            </label>
                        </div>
                    </section>

                    <section className="settings-group">
                        <div className="settings-group__heading">
                            <div className="settings-group__icon"><DatabaseBackup size={18} /></div>
                            <div><h2>Backup personale</h2><p>Backup completo per il tuo account, con storico cloud e copia locale disponibile.</p></div>
                        </div>
                        <div className="settings-inline-info settings-inline-info--warning">Il ripristino sostituisce i campi presenti nel file dopo un'anteprima. I backup provenienti da altri utenti non possono ripristinare cronologie personali.</div>
                        <div className="settings-button-grid">
                            <button className="btn btn-secondary" type="button" onClick={handleExportBackup} disabled={exportingData}><Download size={18} /> {exportingData ? 'Preparazione backup…' : 'Backup JSON'}</button>
                            <label className={`btn btn-primary file-action ${importingData ? 'is-busy' : ''}`}>
                                <Upload size={18} /> {importingData ? 'Import...' : 'Ripristina'}
                                <input type="file" accept=".json" onChange={event => handleImportFile(event, 'restore')} disabled={importingData} />
                            </label>
                        </div>
                        <button className="btn btn-secondary settings-full-action" type="button" onClick={handleExportRecovery}><Archive size={18} /> Esporta archivio precedente</button>
                    </section>

                    <section className="settings-group">
                        <div className="settings-group__heading">
                            <div className="settings-group__icon"><FileSpreadsheet size={18} /></div>
                            <div><h2>Esportazione legacy</h2><p>Formato CSV compatibile con flussi di lavoro e archivi precedenti.</p></div>
                        </div>
                        <button className="btn btn-secondary settings-full-action" type="button" onClick={handleExportCSV}><Download size={18} /> Esporta dati (CSV)</button>
                    </section>

                    <footer className="settings-version">Versione {__APP_VERSION__} · build {__BUILD_HASH__} · {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(__BUILD_TIME__))}</footer>
                </div>
            )}

            {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
            {showTerms && <TermsAndConditions onClose={() => setShowTerms(false)} />}
        </div>
    );
};

export default SettingsView;
