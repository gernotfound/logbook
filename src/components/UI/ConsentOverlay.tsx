import React, { useState } from 'react';
import { Download, HeartPulse, ShieldCheck, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';
import { LEGAL_VERSIONS } from '../../lib/legalVersions';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';
import { TermsAndConditions } from '../../pages/TermsAndConditions';
import { useSettings } from '../../hooks/useSettings';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useDialogStore } from '../../store/useDialogStore';

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
        } catch {
            setIsSaving(false);
            useDialogStore.getState().showAlert('Errore durante il salvataggio del consenso. Controlla la connessione e riprova.');
        }
    };

    return (
        <div className="consent-overlay">
            <section className="consent-card" aria-labelledby="consent-title">
                <div className="consent-card__header">
                    <div className="consent-card__icon"><ShieldCheck size={22} aria-hidden="true" /></div>
                    <div>
                        <span className="page-header__eyebrow">Privacy e salute</span>
                        <h2 id="consent-title">Aggiornamento Termini e Privacy</h2>
                        <p>Per continuare a utilizzare LogBook e rispettare la normativa europea sulla protezione dei dati, leggi e accetta i documenti legali e il trattamento dei dati necessari al servizio.</p>
                    </div>
                </div>

                <div className="consent-options">
                    <label className={`consent-option ${acceptedTerms ? 'is-selected' : ''}`}>
                        <input type="checkbox" checked={acceptedTerms} onChange={event => setAcceptedTerms(event.target.checked)} />
                        <span className="consent-option__check" aria-hidden="true" />
                        <span className="consent-option__copy">
                            <strong>Termini e privacy</strong>
                            <span>
                                Ho letto e accetto i <button className="consent-link" type="button" onClick={event => { event.preventDefault(); setShowTerms(true); }}>Termini e Condizioni</button> e l'<button className="consent-link" type="button" onClick={event => { event.preventDefault(); setShowPrivacy(true); }}>Informativa sulla Privacy</button>.
                            </span>
                        </span>
                    </label>

                    <label className={`consent-option consent-option--health ${acceptedHealth ? 'is-selected' : ''}`}>
                        <input type="checkbox" checked={acceptedHealth} onChange={event => setAcceptedHealth(event.target.checked)} />
                        <span className="consent-option__check" aria-hidden="true" />
                        <span className="consent-option__copy">
                            <strong><HeartPulse size={16} aria-hidden="true" /> Consenso esplicito dati salute (Art. 9 GDPR)</strong>
                            <span>Acconsento al trattamento dei dati relativi alla salute — peso, misure corporee, parametri di allenamento e alimentazione — esclusivamente per il tracciamento e la fornitura del servizio descritti nell'Informativa sulla Privacy. Questo consenso è essenziale per il funzionamento dell'app.</span>
                        </span>
                    </label>
                </div>

                <button className="btn btn-primary consent-primary" disabled={!acceptedTerms || !acceptedHealth || isSaving} onClick={handleAccept}>
                    <ShieldCheck size={18} aria-hidden="true" /> {isSaving ? 'Salvataggio...' : 'Accetta e continua'}
                </button>

                <div className="consent-alternatives">
                    <p>Se non desideri accettare, puoi comunque esercitare i tuoi diritti sui dati:</p>
                    <div>
                        <button className="btn btn-secondary" type="button" onClick={handleExportCSV}><Download size={18} /> Esporta i miei dati (CSV)</button>
                        <button className="btn btn-danger" type="button" onClick={handleDeleteAccount}><Trash2 size={18} /> {isGuest ? 'Elimina dati locali' : 'Elimina account permanentemente'}</button>
                    </div>
                </div>
            </section>

            {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
            {showTerms && <TermsAndConditions onClose={() => setShowTerms(false)} />}
        </div>
    );
};
