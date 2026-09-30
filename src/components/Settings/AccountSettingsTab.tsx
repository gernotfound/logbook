import { Trash2 } from 'lucide-react';
import { AccountCard } from '../UI/AccountCard';

interface AccountSettingsTabProps {
    pendingAccountDeletion: boolean;
    isGuest: boolean;
    deletingAccount: boolean;
    onDeleteAccount: () => void | Promise<void>;
}

export function AccountSettingsTab({ pendingAccountDeletion, isGuest, deletingAccount, onDeleteAccount }: AccountSettingsTabProps) {
    return (
        <section className="settings-detail-stack" aria-label="Account e accesso">
            <AccountCard />
            {pendingAccountDeletion && (
                <div className="settings-detail-card settings-offline-card" role="alert">
                    <h2>Cancellazione account da completare</h2>
                    <p className="settings-help settings-help-last">La sincronizzazione è sospesa e la copia locale è conservata. Puoi esportare un backup e riprendere la cancellazione qui sotto.</p>
                </div>
            )}
            <div className="settings-detail-card settings-danger-card">
                <h2>Zona pericolosa</h2>
                <p className="settings-help">{isGuest ? 'Elimina permanentemente tutti i dati salvati su questo dispositivo. Questa azione è irreversibile.' : 'Elimina permanentemente il tuo account e tutti i dati associati. Questa azione è irreversibile.'}</p>
                <button type="button" className="btn settings-danger-button settings-full" onClick={onDeleteAccount} disabled={deletingAccount}>
                    <Trash2 size={18} aria-hidden="true" />
                    {deletingAccount ? 'Eliminazione...' : (isGuest ? 'Elimina dati locali' : (pendingAccountDeletion ? 'Riprendi cancellazione account' : 'Elimina account e dati'))}
                </button>
            </div>
        </section>
    );
}
