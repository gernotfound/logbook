import { Trash2 } from 'lucide-react';
import { AccountCard } from '../UI/AccountCard';
import { StorageDiagnostics } from './StorageDiagnostics';

interface AccountSettingsTabProps {
    pendingAccountDeletion: boolean;
    isInstallable: boolean;
    isIOSInstallable: boolean;
    isOffline: boolean;
    isGuest: boolean;
    deletingAccount: boolean;
    onPromptInstall: () => void | Promise<void>;
    onCheckUpdate: () => void | Promise<void>;
    onDeleteAccount: () => void | Promise<void>;
}

export function AccountSettingsTab({
    pendingAccountDeletion,
    isInstallable,
    isIOSInstallable,
    isOffline,
    isGuest,
    deletingAccount,
    onPromptInstall,
    onCheckUpdate,
    onDeleteAccount,
}: AccountSettingsTabProps) {
    return (
        <>
            <AccountCard />
            {pendingAccountDeletion && <p role="alert" style={{ color: 'var(--warning-color)' }}>Cancellazione account da completare. La sincronizzazione è sospesa e la copia locale è conservata. Puoi esportare un backup e riprendere la cancellazione qui sotto.</p>}

            {isInstallable && (
                <div className="section-divider">
                    <button className="btn btn-primary" style={{ width: '100%', marginBottom: 0 }} onClick={onPromptInstall}>
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
                <button className="btn" style={{ background: 'var(--surface-light)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', marginBottom: 0 }} onClick={onCheckUpdate}>
                    <span aria-hidden="true">🔄</span> Cerca aggiornamenti
                </button>
            </div>

            <StorageDiagnostics />

            {isOffline && (
                <div className="section-divider">
                    <h2 style={{color: 'var(--warning-color)',marginTop: 0}}><span aria-hidden="true">⚠️</span> Connessione assente</h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', margin: 0 }}>
                        Sei attualmente offline. Puoi continuare a usare l'app: tutte le modifiche verranno salvate localmente e sincronizzate con il cloud non appena tornerà la connessione.
                    </p>
                </div>
            )}

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
                    onClick={onDeleteAccount}
                    disabled={deletingAccount}
                >
                    {deletingAccount ? <><span aria-hidden="true">⏳</span> Eliminazione...</> : (isGuest ? <><Trash2 size={16} aria-hidden="true" /> Elimina dati locali</> : <><Trash2 size={16} aria-hidden="true" /> {pendingAccountDeletion ? 'Riprendi cancellazione account' : 'Elimina account e dati'}</>)}
                </button>
            </div>
        </>
    );
}
