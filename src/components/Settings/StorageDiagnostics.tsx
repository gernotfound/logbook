import { HardDrive } from 'lucide-react';
import { getStorageDiagnosticData } from '../../lib/storageStatus';

export function StorageDiagnostics() {
    const storageDiag = getStorageDiagnosticData();
    return (
        <div className="settings-detail-card">
            <h2><HardDrive size={20} aria-hidden="true" /> Diagnostica archiviazione</h2>
            <p className="settings-help">Stato della persistenza dei dati offline su questo dispositivo.</p>
            {!storageDiag ? <span className="settings-meta">Caricamento...</span> : !storageDiag.supported ? (
                <span className="settings-meta settings-danger">Persistenza non supportata (Storage API mancante).</span>
            ) : (
                <dl className="settings-details">
                    <div><dt>Stato</dt><dd className={storageDiag.persistent ? 'settings-success' : 'settings-warning'}>{storageDiag.persistent ? 'Persistente (Sicuro)' : 'Best-Effort (Volatile)'}</dd></div>
                    {storageDiag.usage !== undefined && storageDiag.quota !== undefined && <div><dt>Utilizzo</dt><dd>{(storageDiag.usage / 1024 / 1024).toFixed(2)} MB / {(storageDiag.quota / 1024 / 1024).toFixed(2)} MB</dd></div>}
                </dl>
            )}
        </div>
    );
}
