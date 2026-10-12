import { ChevronRight, FileText, ShieldCheck } from 'lucide-react';

interface PrivacySettingsTabProps {
    onOpenTerms: () => void;
    onOpenPrivacy: () => void;
    onWithdrawHealthConsent?: () => void;
}

export function PrivacySettingsTab({ onOpenTerms, onOpenPrivacy, onWithdrawHealthConsent }: PrivacySettingsTabProps) {
    return (
        <section className="settings-detail-stack" aria-label="Privacy">
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
                {onWithdrawHealthConsent && <button type="button" className="settings-simple-row" onClick={onWithdrawHealthConsent}><span className="settings-row-copy"><strong>Revoca il consenso per i dati salute</strong><small>L’uso fitness sarà sospeso; rimangono esportazione, diritti e cancellazione account.</small></span><ChevronRight size={20} aria-hidden="true" /></button>}
            </div>
        </section>
    );
}
