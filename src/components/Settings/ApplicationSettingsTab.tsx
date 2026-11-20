import { RefreshCw, Smartphone, WifiOff } from 'lucide-react';
import type { ThemePreference } from '../../store/useAppearanceStore';
import { StorageDiagnostics } from './StorageDiagnostics';

const APPEARANCE_OPTIONS: readonly { id: ThemePreference; label: string }[] = [
    { id: 'system', label: 'Sistema' },
    { id: 'light', label: 'Chiaro' },
    { id: 'dark', label: 'Scuro' },
];

interface ApplicationSettingsTabProps {
    appearance: ThemePreference;
    onAppearanceChange: (preference: ThemePreference) => void;
    appearanceNotSaved: boolean;
    isInstallable: boolean;
    isIOSInstallable: boolean;
    onInstall: () => void;
    isOffline: boolean;
    checkingForUpdate: boolean;
    onCheckUpdate: () => Promise<void>;
}

export function ApplicationSettingsTab({
    appearance, onAppearanceChange, appearanceNotSaved,
    isInstallable, isIOSInstallable, onInstall, isOffline,
    checkingForUpdate, onCheckUpdate,
}: ApplicationSettingsTabProps) {
    return (
        <section className="settings-detail-stack" aria-label="Aspetto e applicazione">
            <div className="settings-detail-card">
                <h2>Tema</h2>
                <fieldset className="appearance-options" aria-label="Tema dell'app">
                    {APPEARANCE_OPTIONS.map(option => (
                        <label key={option.id} className={'appearance-option ' + (appearance === option.id ? 'is-selected' : '')}>
                            <input type="radio" name="appearance" value={option.id} checked={appearance === option.id} onChange={() => onAppearanceChange(option.id)} />
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
                    <button type="button" className="btn btn-primary settings-full" onClick={onInstall}>Installa app sul telefono</button>
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
                <button type="button" className="settings-simple-row" onClick={onCheckUpdate} disabled={checkingForUpdate} aria-busy={checkingForUpdate}>
                    <span className="settings-row-copy"><strong>{checkingForUpdate ? 'Controllo aggiornamenti…' : 'Cerca aggiornamenti'}</strong><small>{checkingForUpdate ? 'Verifica della nuova versione in corso' : 'Controlla se è disponibile una nuova versione'}</small></span>
                    <RefreshCw size={20} aria-hidden="true" />
                </button>
            </div>
            <StorageDiagnostics />
            <p className="settings-version">Versione {__APP_VERSION__} · build {__BUILD_HASH__} · {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(__BUILD_TIME__))}</p>
        </section>
    );
}
