import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { User } from 'firebase/auth';
import { useSettings } from '../../hooks/useSettings';
import { recoverOldLocalEditsAfterConsent } from '../../lib/healthConsentRecovery';
import { useDialogStore } from '../../store/useDialogStore';
import { LEGAL_VERSIONS } from '../../lib/legalVersions';
import { beginGuestHealthReacceptance, completeGuestHealthReacceptance, finishHealthConsentReacceptance, reacceptHealthConsent, reconfirmStaleHealthWithdrawal, retainNewerHealthConsent, refreshHealthConsent, type HealthConsentStatus } from '../../lib/healthConsent';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';
import { TermsAndConditions } from '../../pages/TermsAndConditions';

// The form has its own selection state: switching from pending to confirmed,
 // or back to pending, creates a fresh opt-in without a render-time reset.
function ReacceptanceForm({ enabled, busy, onReaccept }: { enabled: boolean; busy: boolean; onReaccept: () => Promise<void> }) {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedHealth, setAcceptedHealth] = useState(false);

  return <>
    <h2>Per tornare a usare la PWA</h2>
    <p>Esamina i documenti e scegli liberamente se prestare un nuovo consenso. I dati già presenti non vengono cancellati automaticamente.</p>
    <label style={{ display: 'block', marginBlock: 12 }}>
      <input type="checkbox" disabled={!enabled || busy} checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} />
      {' '}Ho almeno 18 anni, ho letto l'informativa e accetto i termini.
    </label>
    <label style={{ display: 'block', marginBlock: 12 }}>
      <input type="checkbox" disabled={!enabled || busy} checked={acceptedHealth} onChange={e => setAcceptedHealth(e.target.checked)} />
      {' '}Presto esplicitamente il consenso al trattamento dei miei dati relativi alla salute per il servizio.
    </label>
    <button className="btn btn-primary" type="button" disabled={!enabled || busy || !acceptedTerms || !acceptedHealth}
      onClick={() => { if (enabled && !busy && acceptedTerms && acceptedHealth) void onReaccept(); }}>
      {busy ? 'Salvataggio in corso…' : 'Presta un nuovo consenso'}
    </button>
  </>;
}

export function HealthConsentSuspended({ status, user }: { status: HealthConsentStatus; user: User | null }) {
  const { handleExportBackup, handleDeleteAccount, handleLogout, exportingData } = useSettings();
  const submitLegalConsent = useAppStore(state => state.submitLegalConsent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const canReaccept = status === 'withdrawn' || status === 'reaccepting';
  const showReacceptForm = status === 'pending' || canReaccept;

  const reaccept = async () => {
    if (!canReaccept || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (user === null) {
        beginGuestHealthReacceptance();
        try {
          await submitLegalConsent({
            hasAcceptedTerms: true, hasAcceptedHealthData: true,
            acceptedAt: new Date().toISOString(),
            privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
          });
          completeGuestHealthReacceptance(true);
        } catch (error) {
          completeGuestHealthReacceptance(false);
          throw error;
        }
        return;
      }
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

  const recover = async () => {
    if (!user || recoveryBusy || busy || exportingData) return;
    const confirmed = await useDialogStore.getState().showConfirm(
      'Hai già esportato una copia dei tuoi dati?\n\nPer riprendere TheLogBook, le modifiche offline precedenti verranno confrontate con tutti i dati cloud e ripresentate come nuove modifiche autorizzate dal consenso appena prestato. Alcune modifiche potrebbero avere conflitti con altri dispositivi.\n\nL’archivio precedente verrà conservato sul dispositivo. Confermi il recupero?'
    );
    if (!confirmed) return;
    setError(null);
    setRecoveryBusy(true);
    try {
      await recoverOldLocalEditsAfterConsent(user);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Recupero non riuscito; i dati locali restano conservati.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  return <main id="auth-overlay" role="main">
    <section className="auth-panel" aria-label="Accesso sospeso" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
      <h1>Accesso a TheLogBook sospeso</h1>
      <p>Allenamenti, nutrizione e diario sono sospesi. Per riattivarli serve un nuovo consenso esplicito dopo la conferma della revoca.</p>
      {user === null && <p>Modalità locale: i dati sono salvati solo su questo dispositivo. Non è necessario contattare il server per la revoca.</p>}
      {status === 'checking' && <p role="status">Verifica dello stato sul server in corso…</p>}
      {status === 'error' && <p role="alert">Non è stato possibile verificare lo stato del consenso. L’accesso fitness resta sospeso.</p>}
      {(status === 'pending' || (status === 'withdrawn' && user !== null)) && <p role="status">
        {status === 'pending'
          ? 'Revoca registrata su questo dispositivo. In attesa della conferma cloud: la nuova accettazione sarà disponibile soltanto dopo la conferma.'
          : 'Revoca confermata sul server. Puoi prestare un nuovo consenso se desideri riattivare la PWA.'}
      </p>}
      {status === 'stale-request' && <section aria-label="Revoca da riconfermare">
        <p role="alert">Una nuova accettazione da un altro dispositivo è più recente della richiesta di revoca rimasta in attesa. La vecchia richiesta non è stata reinviata.</p>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => { void (async () => {
          const confirmed = await useDialogStore.getState().showConfirm('Vuoi revocare nuovamente il consenso aggiornato? Tutte le funzioni fitness saranno sospese.');
          if (!confirmed) return;
          setBusy(true); setError(null);
          try { if (!user) throw new Error('Account non disponibile.'); await reconfirmStaleHealthWithdrawal(user); }
          catch (e) { setError(e instanceof Error ? e.message : 'Impossibile confermare la revoca.'); }
          finally { setBusy(false); }
        })(); }}>Riconferma la revoca</button>
        <button className="btn" type="button" disabled={busy} onClick={() => { void (async () => {
          const confirmed = await useDialogStore.getState().showConfirm('Vuoi mantenere il consenso più recente prestato dall’altro dispositivo? La precedente richiesta di revoca non verrà inviata. Le modifiche offline rimarranno conservate.');
          if (!confirmed) return;
          setBusy(true); setError(null);
          try {
            if (!user) throw new Error('Account non disponibile.');
            const result = await retainNewerHealthConsent(user);
            if (result === 'active') finishHealthConsentReacceptance(user.uid);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Impossibile verificare il consenso più recente.');
          } finally { setBusy(false); }
        })(); }}>Mantieni il nuovo consenso</button>
      </section>}
      {status === 'recovery-required' && <section aria-label="Recupero delle modifiche precedenti">
        <p role="alert">Il nuovo consenso è stato registrato, ma su questo dispositivo ci sono modifiche non sincronizzate prima della revoca. Non le eliminiamo e non le inviamo automaticamente.</p>
        <p>Esporta prima un backup JSON. Poi, solo se lo desideri, puoi scegliere esplicitamente di recuperare le vecchie modifiche confrontandole con i dati aggiornati del cloud. La copia originale resterà conservata anche sul dispositivo.</p>
        <button type="button" className="btn btn-primary" disabled={recoveryBusy || exportingData} onClick={() => void recover()}>
          {recoveryBusy ? 'Recupero in corso…' : 'Recupera modifiche e riattiva'}
        </button>
      </section>}
      {status === 'reaccepting' && <p role="status">Nuovo consenso in fase di completamento. Riconferma qui sotto per completare.</p>}
      {showReacceptForm &&
        <ReacceptanceForm
          key={canReaccept ? 'confirmed' : 'awaiting-confirmation'}
          enabled={canReaccept}
          busy={busy}
          onReaccept={reaccept}
        />}
      <h2>Gestisci i tuoi dati e i tuoi diritti</h2>
      <p>Puoi farlo anche senza prestare un nuovo consenso.</p>
      <div style={{ display: 'grid', gap: 12 }}>
        <button type="button" className="btn" onClick={() => setPrivacy(true)}>Leggi l’informativa privacy</button>
        <button type="button" className="btn" onClick={() => setTerms(true)}>Leggi i termini e condizioni</button>
        <button type="button" className="btn" onClick={() => void handleExportBackup()} disabled={exportingData}>{exportingData ? 'Preparazione…' : 'Esporta i tuoi dati (backup JSON)'}</button>
        <button type="button" className="btn" onClick={() => void handleLogout()}>Esci dall'account</button>
        <button type="button" className="btn" onClick={() => void handleDeleteAccount()}>Elimina definitivamente l'account</button>
        {user !== null && <button type="button" className="btn" disabled={busy} onClick={() => { void refreshHealthConsent(user); }}>Riprova a verificare il consenso</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
    {privacy && <PrivacyPolicy onClose={() => setPrivacy(false)} />}
    {terms && <TermsAndConditions onClose={() => setTerms(false)} />}
  </main>;
}
