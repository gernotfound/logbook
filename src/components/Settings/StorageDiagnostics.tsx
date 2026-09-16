import { getStorageDiagnosticData } from '../../lib/storageStatus';

export function StorageDiagnostics() {
    const storageDiag = getStorageDiagnosticData();

    return (
        <div className="section-divider">
            <h3 style={{margin: '0 0 10px 0'}}><span aria-hidden="true">🔧</span> Diagnostica archiviazione</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 10px 0' }}>Stato della persistenza dei dati offline su questo dispositivo.</p>
            {!storageDiag ? (
                <span style={{ fontSize: '0.85rem' }}>Caricamento...</span>
            ) : !storageDiag.supported ? (
                <span style={{ fontSize: '0.85rem', color: 'var(--danger-color)' }}>Persistenza non supportata (Storage API mancante).</span>
            ) : (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span>Stato:</span>
                        <span style={{ color: storageDiag.persistent ? 'var(--success-color)' : 'var(--warning-color)', fontWeight: 'bold' }}>
                            {storageDiag.persistent ? 'Persistente (Sicuro)' : 'Best-Effort (Volatile)'}
                        </span>
                    </div>
                    {storageDiag.usage !== undefined && storageDiag.quota !== undefined && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Utilizzo:</span>
                            <span>{(storageDiag.usage / 1024 / 1024).toFixed(2)} MB / {(storageDiag.quota / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
