import { ChevronRight, FileText, ShieldCheck } from 'lucide-react';

interface PrivacySettingsTabProps {
    analyticsEnabled: boolean;
    onOpenTerms: () => void;
    onOpenPrivacy: () => void;
    onToggleAnalytics: () => void;
}

export function PrivacySettingsTab({ analyticsEnabled, onOpenTerms, onOpenPrivacy, onToggleAnalytics }: PrivacySettingsTabProps) {
    return (
        <section className="settings-detail-stack" aria-label="Privacy">
            <div className="settings-toggle-card">
                <div>
                    <strong>Statistiche di utilizzo</strong>
                    <p>Abilita Google Analytics (GA4). È opzionale, disattivato per impostazione predefinita e revocabile in qualsiasi momento.</p>
                </div>
                <label className="settings-switch">
                    <input type="checkbox" id="analytics-toggle" aria-label="Statistiche di utilizzo" checked={analyticsEnabled} onChange={onToggleAnalytics} />
                    <span aria-hidden="true" />
                </label>
            </div>
            <div className="settings-detail-list">
                <button type="button" className="settings-simple-row" onClick={onOpenPrivacy}>
                    <span className="settings-row-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
                    <span className="settings-row-copy"><strong>Informativa sulla privacy</strong></span>
                    <ChevronRight size={20} aria-hidden="true" />
                </button>
                <button type="button" className="settings-simple-row" onClick={onOpenTerms}>
                    <span className="settings-row-icon"><FileText size={20} aria-hidden="true" /></span>
                    <span className="settings-row-copy"><strong>Termini e condizioni</strong></span>
                    <ChevronRight size={20} aria-hidden="true" />
                </button>
            </div>
        </section>
    );
}
