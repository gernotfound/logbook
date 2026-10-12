import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useSettings } from '../../hooks/useSettings';
import { LEGAL_VERSIONS } from '../../lib/legalVersions';
import { finishHealthConsentReacceptance, reacceptHealthConsent, refreshHealthConsent, type HealthConsentStatus } from '../../lib/healthConsent';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';
import { TermsAndConditions } from '../../pages/TermsAndConditions';

export function HealthConsentSuspended({ status, user }: { status: HealthConsentStatus; user: User }) {
  const { handleExportBackup, handleDeleteAccount, exportingData } = useSettings();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedHealth, setAcceptedHealth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);

  const reaccept = async () => {
    if (!acceptedTerms || !acceptedHealth || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reacceptHealthConsent(user, {
        acceptedTerms: true, acceptedHealthData: true,
        privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
      });
      const refreshed = await refreshHealthConsent(user);
      if (refreshed !== 'active') throw new Error('Dati locali pendenti da recuperare prima della riattivazione.');
      finishHealthConsentReacceptance(user.uid);
    } catch {
      setError('Non è stato possibile completare il nuovo consenso. L’accesso resta sospeso; nessun dato è stato eliminato.');
    } finally { setBusy(false); }
  };

  return <main id="auth-overlay" role="main">
    <section className="auth-panel" aria-label="Accesso sospeso" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
      <h1>Accesso a TheLogBook sospeso</h1>
      <p>Non puoi usare allenamenti, nutrizione o diario finché non presti nuovamente il consenso esplicito per i dati salute.</p>
      {status === 'checking' && <p role="status">Verifica dello stato sul server in corso…</p>}
      {status === 'error' && <p role="alert">Non è stato possibile verificare lo stato del consenso. L’accesso fitness resta sospeso.</p>}
      {status === 'pending' && <p role="status">Revoca registrata su questo dispositivo. La conferma cloud è ancora in attesa.</p>}
      {status === 'recovery-required' && <p role="alert">Su questo dispositivo sono presenti modifiche di una sessione precedente. Per evitare di sovrascriverle non possono essere sincronizzate automaticamente con il nuovo consenso. Esporta un backup locale per conservarle prima di continuare.</p>}
      {status === 'reaccepting' && <p role="status">Nuovo consenso in fase di completamento. Riconferma qui sotto per completare.</p>}
      {(status === 'withdrawn' || status === 'reaccepting') && <>
        <h2>Per tornare a usare la PWA</h2>
        <p>Esamina i documenti e scegli liberamente se prestare un nuovo consenso. I dati già presenti non vengono cancellati automaticamente.</p>
        <label style={{ display: 'block', marginBlock: 12 }}>
          <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} />
          {' '}Ho almeno 18 anni, ho letto l'informativa e accetto i termini.
        </label>
        <label style={{ display: 'block', marginBlock: 12 }}>
          <input type="checkbox" checked={acceptedHealth} onChange={e => setAcceptedHealth(e.target.checked)} />
          {' '}Presto esplicitamente il consenso al trattamento dei miei dati relativi alla salute per il servizio.
        </label>
        <button className="btn btn-primary" type="button" disabled={busy || !acceptedTerms || !acceptedHealth} onClick={() => void reaccept()}>
          {busy ? 'Salvataggio in corso…' : 'Presta un nuovo consenso'}
        </button>
      </>}
      <h2>Gestisci i tuoi dati e i tuoi diritti</h2>
      <p>Puoi farlo anche senza prestare un nuovo consenso.</p>
      <div style={{ display: 'grid', gap: 12 }}>
        <button type="button" className="btn" onClick={() => setPrivacy(true)}>Leggi l’informativa privacy</button>
        <button type="button" className="btn" onClick={() => setTerms(true)}>Leggi i termini e condizioni</button>
        <button type="button" className="btn" onClick={() => void handleExportBackup()} disabled={exportingData}>{exportingData ? 'Preparazione…' : 'Esporta i tuoi dati (backup JSON)'}</button>
        <button type="button" className="btn" onClick={() => void handleDeleteAccount()}>Elimina definitivamente l'account</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { void refreshHealthConsent(user); }}>Riprova a verificare il consenso</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
    {privacy && <PrivacyPolicy onClose={() => setPrivacy(false)} />}
    {terms && <TermsAndConditions onClose={() => setTerms(false)} />}
  </main>;
}
