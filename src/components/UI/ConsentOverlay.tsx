import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';
import { LEGAL_VERSIONS } from '../../lib/legalVersions';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';
import { TermsAndConditions } from '../../pages/TermsAndConditions';
import { useSettings } from '../../hooks/useSettings';

export const ConsentOverlay: React.FC = () => {
    const { isGuest } = useAuth();
    const { handleExport, handleDeleteAccount } = useSettings();
    const updateUserData = useAppStore(state => state.updateUserData);
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [acceptedHealth, setAcceptedHealth] = useState(false);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showTerms, setShowTerms] = useState(false);

    const handleAccept = () => {
        if (!acceptedTerms || !acceptedHealth) return;
        updateUserData((prev) => ({
            ...prev,
            legalConsent: {
                hasAcceptedTerms: true,
                hasAcceptedHealthData: true,
                acceptedAt: new Date().toISOString(),
                privacyVersion: LEGAL_VERSIONS.privacy,
                termsVersion: LEGAL_VERSIONS.terms
            }
        }));
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(13, 13, 13, 0.95)',
            backdropFilter: 'blur(10px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '16px',
            overflowY: 'auto',
        }}>
            <div style={{
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--glass-border)',
                borderRadius: '16px',
                maxWidth: '600px',
                width: '100%',
                marginTop: 'auto',
                marginBottom: 'auto',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px'
            }}>
                <h2 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.4rem' }}>
                    Aggiornamento Termini e Privacy
                </h2>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                    Per continuare a utilizzare LogBook e per essere conformi alle normative europee sulla protezione dei dati (GDPR), ti chiediamo di leggere e accettare i nostri documenti legali e di acconsentire al trattamento dei tuoi dati.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {/* Checkbox 1: T&C e Privacy */}
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={acceptedTerms}
                            onChange={(e) => setAcceptedTerms(e.target.checked)}
                            style={{ width: '20px', height: '20px', accentColor: 'var(--primary-color)', marginTop: '2px', flexShrink: 0 }}
                        />
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: '1.4' }}>
                            Ho letto e accetto i <button className="btn-link" style={{ padding: 0, background: 'none', border: 'none', color: 'var(--primary-color)', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.9rem' }} onClick={(e) => { e.preventDefault(); setShowTerms(true); }}>Termini e Condizioni</button> e l'<button className="btn-link" style={{ padding: 0, background: 'none', border: 'none', color: 'var(--primary-color)', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.9rem' }} onClick={(e) => { e.preventDefault(); setShowPrivacy(true); }}>Informativa sulla Privacy</button>.
                        </span>
                    </label>

                    {/* Checkbox 2: Dati Salute */}
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', padding: '16px', border: '2px solid rgba(255, 77, 109, 0.4)', borderRadius: '12px', backgroundColor: 'rgba(255, 77, 109, 0.05)' }}>
                        <input
                            type="checkbox"
                            checked={acceptedHealth}
                            onChange={(e) => setAcceptedHealth(e.target.checked)}
                            style={{ width: '20px', height: '20px', accentColor: 'var(--primary-color)', marginTop: '2px', flexShrink: 0 }}
                        />
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: '1.4' }}>
                            <strong>Consenso esplicito dati salute (Art. 9 GDPR):</strong> Acconsento al trattamento dei miei dati relativi alla salute (peso, misure corporee, parametri di allenamento e alimentazione) per le finalità esclusive di tracciamento e fornitura del servizio descritte nell'Informativa sulla Privacy. Questo consenso è essenziale per il funzionamento dell'app.
                        </span>
                    </label>
                </div>

                <button
                    className="btn btn-primary"
                    disabled={!acceptedTerms || !acceptedHealth}
                    onClick={handleAccept}
                    style={{ padding: '14px', fontSize: '1rem', marginTop: '10px' }}
                >
                    Accetta e Continua
                </button>

                <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--glass-border)' }}>
                    <p style={{ margin: '0 0 12px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Se non desideri accettare, puoi comunque esercitare i tuoi diritti sui dati:
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)' }} onClick={handleExport}>
                            <span aria-hidden="true">📥</span> Esporta i miei dati (CSV)
                        </button>
                        <button className="btn" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger-color)', border: '1px solid var(--danger-color)' }} onClick={handleDeleteAccount}>
                            <span aria-hidden="true">🗑️</span> {isGuest ? 'Elimina dati locali' : 'Elimina account permanentemente'}
                        </button>
                    </div>
                </div>

            </div>

            {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
            {showTerms && <TermsAndConditions onClose={() => setShowTerms(false)} />}
        </div>
    );
};
