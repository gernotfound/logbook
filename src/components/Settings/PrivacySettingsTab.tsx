interface PrivacySettingsTabProps {
    analyticsEnabled: boolean;
    onOpenTerms: () => void;
    onOpenPrivacy: () => void;
    onToggleAnalytics: () => void;
}

export function PrivacySettingsTab({
    analyticsEnabled,
    onOpenTerms,
    onOpenPrivacy,
    onToggleAnalytics,
}: PrivacySettingsTabProps) {
    return (
        <>
            <div className="section-divider" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{margin: '0 0 5px 0'}}><span aria-hidden="true">⚖️</span> Legale e Privacy</h3>
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', margin: 0 }} onClick={onOpenTerms}>
                    <span aria-hidden="true">📄</span> Termini e Condizioni
                </button>
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', margin: 0 }} onClick={onOpenPrivacy}>
                    <span aria-hidden="true">📋</span> Informativa sulla Privacy
                </button>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    Titolare del trattamento: LogBook Developer<br/>
                    Email: privacy@logbook.example.com
                </div>
            </div>

            <div className="section-divider">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{margin: '0 0 5px 0',color: 'var(--text-main)'}}>Statistiche di utilizzo</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Condividi dati anonimi di diagnostica e Analytics per aiutarci a migliorare l'app.</p>
                    </div>
                    <input type="checkbox" id="analytics-toggle" checked={analyticsEnabled} onChange={onToggleAnalytics} style={{ width: '24px', height: '24px', accentColor: 'var(--primary-color)', marginLeft: '10px' }} />
                </div>
            </div>
        </>
    );
}
