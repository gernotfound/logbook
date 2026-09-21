import React, { useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';
import { LEGAL_VERSIONS } from '../../lib/legalVersions';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';
import { TermsAndConditions } from '../../pages/TermsAndConditions';
import { useSettings } from '../../hooks/useSettings';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useDialogStore } from '../../store/useDialogStore';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';

export const ConsentOverlay: React.FC = () => {
    useScrollLock();
    const { isGuest } = useAuth();
    const { handleExportCSV, handleDeleteAccount } = useSettings();
    const submitLegalConsent = useAppStore(state => state.submitLegalConsent);
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [acceptedHealth, setAcceptedHealth] = useState(false);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showTerms, setShowTerms] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const globalDialogOpen = useDialogStore(state => state.isOpen);
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const firstCheckboxRef = useRef<HTMLInputElement>(null);
    useModalFocusTrap({
        containerRef: dialogRef,
        initialFocusRef: firstCheckboxRef,
        active: !showPrivacy && !showTerms && !globalDialogOpen,
    });

    const handleAccept = async () => {
        if (!acceptedTerms || !acceptedHealth || isSaving) return;
        setIsSaving(true);
        try {
            await submitLegalConsent({
                hasAcceptedTerms: true,
                hasAcceptedHealthData: true,
                acceptedAt: new Date().toISOString(),
                privacyVersion: LEGAL_VERSIONS.privacy,
                termsVersion: LEGAL_VERSIONS.terms
            });
            // App.tsx smonta l'overlay perché legalConsent è stato valorizzato.
        } catch {
            setIsSaving(false);
            useDialogStore.getState().showAlert(
                'Errore durante il salvataggio del consenso. Controlla la connessione e riprova.'
            );
        }
    };

    return (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="ui-consent-overlay-1" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "1rem", overflowY: "auto" }}>
            <div className="ui-consent-overlay-2" style={{ maxWidth: "37.5rem", width: "100%", marginTop: "auto", marginBottom: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <h2 id={titleId} className="ui-consent-overlay-3" style={{ margin: 0 }}>
                    Aggiornamento Termini e Privacy
                </h2>
                <p className="ui-consent-overlay-4" style={{ margin: 0, lineHeight: "1.5" }}>
                    Per continuare a utilizzare LogBook e per essere conformi alle normative europee sulla protezione dei dati (GDPR), ti chiediamo di leggere e accettare i nostri documenti legali e di acconsentire al trattamento dei tuoi dati.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.9375rem" }}>
                    {/* Checkbox 1: T&C e Privacy */}
                    <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: "pointer" }}>
                        <input
                            ref={firstCheckboxRef}
                            type="checkbox"
                            checked={acceptedTerms}
                            onChange={(e) => setAcceptedTerms(e.target.checked)}
                            style={{ width: "1.25rem", height: "1.25rem", accentColor: "var(--primary-color)", marginTop: "0.125rem", flexShrink: 0 }}
                        />
                        <span className="ui-consent-overlay-5" style={{ lineHeight: "1.4" }}>
                            Ho letto e accetto i <button className="btn-link ui-consent-overlay-6" style={{ padding: 0, textDecoration: "underline", cursor: "pointer" }} onClick={(e) => { e.preventDefault(); setShowTerms(true); }}>Termini e Condizioni</button> e l'<button className="btn-link ui-consent-overlay-7" style={{ padding: 0, textDecoration: "underline", cursor: "pointer" }} onClick={(e) => { e.preventDefault(); setShowPrivacy(true); }}>Informativa sulla Privacy</button>.
                        </span>
                    </label>

                    {/* Checkbox 2: Dati Salute */}
                    <label className="ui-consent-overlay-8" style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: "pointer", padding: "1rem" }}>
                        <input
                            type="checkbox"
                            checked={acceptedHealth}
                            onChange={(e) => setAcceptedHealth(e.target.checked)}
                            style={{ width: "1.25rem", height: "1.25rem", accentColor: "var(--primary-color)", marginTop: "0.125rem", flexShrink: 0 }}
                        />
                        <span className="ui-consent-overlay-9" style={{ lineHeight: "1.4" }}>
                            <strong>Consenso esplicito dati salute (Art. 9 GDPR):</strong> Acconsento al trattamento dei miei dati relativi alla salute (peso, misure corporee, parametri di allenamento e alimentazione) per le finalità esclusive di tracciamento e fornitura del servizio descritte nell'Informativa sulla Privacy. Questo consenso è essenziale per il funzionamento dell'app.
                        </span>
                    </label>
                </div>

                <button
                    className="btn btn-primary ui-consent-overlay-10"
                    disabled={!acceptedTerms || !acceptedHealth || isSaving}
                    onClick={handleAccept}
                    style={{ padding: "0.875rem", marginTop: "0.625rem" }}
                >
                    {isSaving ? 'Salvataggio...' : 'Accetta e continua'}
                </button>

                <div className="ui-consent-overlay-11" style={{ marginTop: "1.25rem", paddingTop: "1.25rem" }}>
                    <p className="ui-consent-overlay-12" style={{ margin: "0 0 0.75rem 0" }}>
                        Se non desideri accettare, puoi comunque esercitare i tuoi diritti sui dati:
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                        <button className="btn ui-consent-overlay-13"  onClick={handleExportCSV}>
                            <span aria-hidden="true">📥</span> Esporta i miei dati (CSV)
                        </button>
                        <button className="btn ui-consent-overlay-14"  onClick={handleDeleteAccount}>
                            <Trash2 size={16} aria-hidden="true" /> {isGuest ? 'Elimina dati locali' : 'Elimina account permanentemente'}
                        </button>
                    </div>
                </div>

            </div>

            {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
            {showTerms && <TermsAndConditions onClose={() => setShowTerms(false)} />}
        </div>
    );
};
