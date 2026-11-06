import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { User } from 'firebase/auth';
import { useSettings } from '../../hooks/useSettings';
import { recoverOldLocalEditsAfterConsent } from '../../lib/healthConsentRecovery';
import { useDialogStore } from '../../store/useDialogStore';
import { LEGAL_VERSIONS } from '../../lib/legalVersions';
import { finishHealthConsentReacceptance, registerInitialHealthConsent, reacceptHealthConsent, reconfirmStaleHealthWithdrawal, retainNewerHealthConsent, refreshHealthConsent, subscribeHealthConsent, isVerifiedHealthWithdrawal, type HealthConsentStatus } from '../../lib/healthConsent';
import { safeHardReload } from '../../lib/sync/safeReload';
import { UnverifiedTabSnapshotError } from '../../lib/sync/reloadBarrier';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';
import { TermsAndConditions } from '../../pages/TermsAndConditions';
import { auth, signOut } from '../../lib/firebase';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { readLocal } from '../../lib/sync/localRepository';
import { isLocalPurgeIncomplete } from '../../lib/sync/localPurgeFence';
import { hasDeviceRecoveryBackupSource } from '../../lib/db/backupSnapshot';
import { purgeCompletedHealthDataLocal } from '../../lib/db/db_account';
import { readHealthDataErasureProgress, type HealthDataErasureOutcome } from '../../lib/healthDataErasure';

// The form has its own selection state: switching from pending to confirmed,
 // or back to pending, creates a fresh opt-in without a render-time reset.
function ReacceptanceForm({ enabled, busy, onReaccept, firstAcceptance = false }: {
  enabled: boolean; busy: boolean; onReaccept: () => Promise<void>; firstAcceptance?: boolean;
}) {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedHealth, setAcceptedHealth] = useState(false);

  return <>
    <h2>{firstAcceptance ? 'Prima di iniziare a usare TheLogBook' : 'Per tornare a usare la PWA'}</h2>
    <p>{firstAcceptance
      ? 'Esamina i documenti e presta il primo consenso esplicito per usare il tuo account. Il consenso viene registrato dal server prima di permettere la sincronizzazione.'
      : 'La cancellazione dei dati precedenti è stata verificata. Un nuovo consenso avvia un archivio vuoto e non ripristina i dati cancellati.'}</p>
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
      {busy ? 'Salvataggio in corso…' : firstAcceptance ? 'Accetta e continua' : 'Presta un nuovo consenso'}
    </button>
  </>;
}

export function HealthConsentSuspended({ status, user }: { status: HealthConsentStatus; user: User | null }) {
  const { handlePrepareBackup, preparedBackupUrl, releasePreparedBackup, handleDeleteAccount, erasingHealthData, handleLogout, exportingData } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const verifiedWithdrawal = useSyncExternalStore(subscribeHealthConsent,
    () => user !== null && isVerifiedHealthWithdrawal(user.uid), () => false);
  const [erasureProgress, setErasureProgress] = useState<HealthDataErasureOutcome | null>(null);
  const [checkingErasure, setCheckingErasure] = useState(false);
  const [localReadyUid, setLocalReadyUid] = useState<string | null>(null);
  const checkingErasureRef = useRef(false);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const onOffline = () => setOffline(true);
    // AuthProvider already performs the authoritative online/foreground
    // refresh. A second concurrent UI refresh would supersede its result
    // and could leave the cloud hydrate idle after consent reconciliation.
    const onOnline = () => setOffline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setOffline(navigator.onLine === false);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const initialAcceptance = status === 'unregistered' && user !== null;
  const canReaccept = user !== null && localReadyUid === user.uid && (status === 'withdrawn' || status === 'reaccepting');
  const showReacceptForm = initialAcceptance || canReaccept;

  const verifyAutomaticErasure = useCallback(async () => {
    if (!user || status !== 'withdrawn' || !verifiedWithdrawal || offline || checkingErasureRef.current
        || auth.currentUser?.uid !== user.uid) return;
    checkingErasureRef.current = true;
    setCheckingErasure(true);
    setError(null);
    const session = captureSession();
    const uid = user.uid;
    const owner = 'user:' + uid;
    try {
      if (session.owner !== owner) throw new Error('Account diverso da quello da cancellare.');
      const progress = await readHealthDataErasureProgress(user);
      if (!isCurrentSession(session) || auth.currentUser?.uid !== uid) return;
      setErasureProgress(progress);
      if (!progress.complete) {
        if (progress.status === 'failed') {
          setError('Cancellazione cloud incompleta. Non riattivare né importare archivi precedenti; riprova la verifica o richiedi assistenza.');
        }
        return;
      }
      // A fresh login can have no old owner archive. In that case enable a
      // *new* explicit consent without repeatedly signing out the same user.
      // The durable purge fence blocks ordinary IndexedDB reads. Check it
      // BEFORE readLocal/device backup inspection: an interrupted purge can
      // already have removed its envelope while leaving other owner keys.
      const interruptedPurge = isLocalPurgeIncomplete(owner);
      const envelope = interruptedPurge ? undefined : await readLocal(owner);
      if (!isCurrentSession(session) || auth.currentUser?.uid !== uid) return;
      const app = useAppStore.getState();
      const hasLocalData = interruptedPurge || envelope !== undefined
        || hasDeviceRecoveryBackupSource(owner)
        || (app.dataOwner === owner && app.userData !== null);
      if (!hasLocalData) {
        setLocalReadyUid(uid);
        return;
      }
      await purgeCompletedHealthDataLocal(owner);
      // A→B→A is a new authenticated session even when Firebase UID matches:
      // never reset the new session's state or sign it out on a stale callback.
      if (!isCurrentSession(session) || auth.currentUser?.uid !== uid) return;
      useAppStore.getState().resetStore({ force: true });
      await signOut(auth);
      await useDialogStore.getState().showAlert(
        'La cancellazione dei dati applicativi è completata su questo dispositivo e nel database operativo. Il tuo account è stato conservato. Puoi accedere di nuovo e prestare un nuovo consenso per ripartire da zero.',
        'Dati cancellati',
      );
    } catch (cause) {
      if (auth.currentUser?.uid === uid) {
        setError(cause instanceof Error ? cause.message : 'Impossibile verificare la cancellazione.');
      }
    } finally {
      checkingErasureRef.current = false;
      setCheckingErasure(false);
    }
  }, [user, status, offline, verifiedWithdrawal]);
  useEffect(() => {
    if (status === 'withdrawn' && user !== null && verifiedWithdrawal && !offline) {
      // Defer state changes beyond the effect setup; avoid redundant work on
      // the same owner when the component rerenders with progress feedback.
      void Promise.resolve().then(verifyAutomaticErasure);
    }
  }, [status, user, verifiedWithdrawal, offline, verifyAutomaticErasure]);

  const acceptInitial = async () => {
    if (!user || !initialAcceptance || busy) return;
    setBusy(true);
    setError(null);
    try {
      await registerInitialHealthConsent(user, {
        acceptedTerms: true, acceptedHealthData: true,
        privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
      });
      // Preserve the guest-to-account migration intent and re-enter the normal
      // authenticated bootstrap only after the safe local flush.
      await safeHardReload();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Registrazione del primo consenso non riuscita.');
    } finally { setBusy(false); }
  };

  const reaccept = async () => {
    if (!canReaccept || !user || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reacceptHealthConsent(user, {
        acceptedTerms: true, acceptedHealthData: true,
        privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
      });
      const refreshed = await refreshHealthConsent(user);
      // The server accepted the new consent, but older local edits still need
      // the person's separate, explicit recovery choice. This is not a failed
      // consent: keep the suspension and let the recovery screen explain it.
      if (refreshed === 'recovery-required' || refreshed === 'erasure-required') return;
      if (refreshed !== 'active') throw new Error('Nuovo consenso non ancora verificato su questo dispositivo.');
      finishHealthConsentReacceptance(user.uid);
    } catch {
      setError('Non è stato possibile completare il nuovo consenso. L’accesso resta sospeso: verifica prima lo stato della cancellazione.');
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

  const reloadPage = async () => {
    if (busy || recoveryBusy || exportingData) return;
    setError(null);
    try {
      await safeHardReload();
    } catch (error) {
      if (!(error instanceof UnverifiedTabSnapshotError)) {
        setError(error instanceof Error ? error.message : 'Impossibile ricaricare in sicurezza.');
        return;
      }
      const confirmed = await useDialogStore.getState().showConfirm(
        'Alcuni dati presenti solo in memoria non corrispondono all’archivio salvato. Non possiamo verificare che tutte le modifiche siano state conservate.\\n\\nSe continui, questi dati in memoria potrebbero andare persi; l’archivio salvato sul dispositivo e le modifiche ancora pendenti non verranno cancellati.\\n\\nVuoi ricaricare comunque?'
      );
      if (!confirmed) return;
      try {
        await safeHardReload(undefined, { discardUnverifiedInMemoryData: true });
      } catch (retryError) {
        setError(retryError instanceof Error ? retryError.message : 'Impossibile ricaricare in sicurezza.');
      }
    }
  };

  return <main id="auth-overlay" role="main">
    <section className="auth-panel" aria-label="Accesso sospeso" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
      <h1>{initialAcceptance ? 'Primo consenso richiesto' : status === 'checking' ? 'Verifica del consenso in corso' : status === 'error' ? 'Verifica del consenso non riuscita' : 'Accesso a TheLogBook sospeso'}</h1>
      <p>{status === 'checking'
        ? 'Stiamo verificando il consenso già registrato sul server. Questo stato non significa che tu abbia revocato il consenso: non serve prestarlo nuovamente.'
        : status === 'error'
          ? 'Non è stato possibile verificare il consenso sul server. Questo stato non significa che tu abbia revocato il consenso: puoi riprovare senza accettarlo nuovamente.'
        : status === 'erasure-required'
          ? 'Il nuovo consenso è attivo, ma questo dispositivo conserva un archivio di una generazione che è stata cancellata dal cloud. La vecchia copia non può essere riattivata o sincronizzata.'
          : initialAcceptance ? 'Il tuo account non ha ancora un primo consenso registrato sul server. L’accesso fitness e la sincronizzazione restano sospesi fino all’accettazione esplicita.' : 'Allenamenti, nutrizione e diario sono sospesi. Per riattivarli serve un nuovo consenso esplicito dopo la conferma della revoca.'}</p>
      {user === null && <p>Modalità locale: i dati sono salvati solo su questo dispositivo. Non è necessario contattare il server per la revoca.</p>}
      {status === 'checking' && <p role="status">Verifica dello stato sul server in corso…</p>}
      {status === 'error' && <>
        <p role="alert">La verifica non è riuscita entro il tempo previsto oppure il servizio non è disponibile. I dati restano conservati e l’accesso cloud non è autorizzato.</p>
        {user !== null && <button className="btn btn-primary" type="button" onClick={() => {
          window.dispatchEvent(new Event('logbook:retry-health-consent'));
        }}>Riprova la verifica</button>}
      </>}
      {(status === 'pending' || (status === 'withdrawn' && user !== null)) && <p role="status">
        {status === 'pending'
          ? offline
            ? 'Revoca registrata solo sul dispositivo. Le funzioni fitness restano bloccate e la cancellazione cloud partirà dopo la conferma del server.'
            : 'Revoca registrata su questo dispositivo. In attesa della conferma cloud: riprova la verifica se la connessione è tornata.'
          : verifiedWithdrawal
            ? 'Revoca confermata sul server. La cancellazione automatica dei dati applicativi è stata avviata; un nuovo consenso sarà disponibile solo dopo la verifica del completamento.'
            : 'Revoca registrata su questo dispositivo. Verifica del server ancora necessaria prima di confermare la cancellazione.'}
      </p>}
      {user !== null && status === 'withdrawn' && (
        <section aria-label="Cancellazione automatica dei dati">
          <p>La revoca avvia automaticamente la cancellazione dei dati applicativi, mantenendo l'account. Le copie su dispositivi offline, file esportati e backup tecnici dei fornitori hanno limiti di eliminazione separati.</p>
          <p role="status">{localReadyUid === user.uid
            ? 'Cancellazione cloud completata e nessun archivio locale precedente rilevato. Puoi iniziare con un nuovo consenso.'
            : checkingErasure
              ? 'Verifica della cancellazione in corso…'
              : erasureProgress?.complete
                ? 'Cloud cancellato. La pulizia locale deve ancora essere verificata.'
                : erasureProgress?.status === 'failed'
                  ? 'Cancellazione cloud incompleta. È necessario riprendere o verificare il job.'
                  : 'Cancellazione richiesta: il server continua in modo riprendibile anche se chiudi la pagina.'}</p>
          <button type="button" className="btn" disabled={checkingErasure || busy || offline || !verifiedWithdrawal}
            onClick={() => { void verifyAutomaticErasure(); }}>
            {checkingErasure ? 'Verifica in corso…' : 'Verifica stato cancellazione'}
          </button>
          {offline && <p role="status">Riconnettiti per verificare i dati cloud e completare la pulizia locale.</p>}
        </section>
      )}
      {user === null && status === 'withdrawn' && (
        <section aria-label="Cancellazione dei dati locali dopo la revoca">
          <p>Puoi eliminare i dati ospite salvati su questo dispositivo. Non è necessaria una connessione.</p>
          <button type="button" className="btn" disabled={busy || recoveryBusy || exportingData || erasingHealthData}
            onClick={() => { void handleDeleteAccount(); }}>Elimina dati di questo dispositivo</button>
        </section>
      )}
      {status === 'stale-request' && <section aria-label="Revoca da riconfermare">
        <p role="alert">Una nuova accettazione da un altro dispositivo è più recente della richiesta di revoca rimasta in attesa. La vecchia richiesta non è stata reinviata.</p>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => { void (async () => {
          const confirmed = await useDialogStore.getState().showConfirm('Vuoi revocare il consenso più recente? I dati fitness verranno cancellati automaticamente dopo la conferma del server, senza eliminare l’account.');
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
      {status === 'erasure-required' && <section aria-label="Copia locale di dati cancellati">
        <p role="alert">La cancellazione dei dati eseguita sul cloud include la generazione della copia conservata qui. Per rispettare quella cancellazione, TheLogBook non la trasforma automaticamente in dati nuovi.</p>
        <p>I dati cancellati non possono essere riattivati o recuperati nella PWA. Puoi scegliere «Esci dall'account» per ripulire questo dispositivo e accedere nuovamente con un archivio vuoto; se sono presenti dati non sincronizzati, la protezione del logout può sospendere l'operazione. Se non riesci a completarla, contatta l'assistenza privacy.</p>
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
          key={initialAcceptance ? 'initial' : canReaccept ? 'confirmed' : 'awaiting-confirmation'}
          enabled={canReaccept || initialAcceptance}
          busy={busy || erasingHealthData}
          onReaccept={initialAcceptance ? acceptInitial : reaccept}
          firstAcceptance={initialAcceptance}
        />}
      <h2>Gestisci i tuoi dati e i tuoi diritti</h2>
      <p>Puoi farlo anche senza prestare un nuovo consenso.</p>
      <p>Il backup JSON esportato non è cifrato e, se il cloud non è disponibile, può essere parziale. Conservalo in un luogo protetto.</p>
      <div style={{ display: 'grid', gap: 12 }}>
        <button type="button" className="btn" onClick={() => setPrivacy(true)}>Leggi l’informativa privacy</button>
        <button type="button" className="btn" onClick={() => setTerms(true)}>Leggi i termini e condizioni</button>
        <button type="button" className="btn" onClick={() => { void handlePrepareBackup().catch(error => setError(error instanceof Error ? error.message : 'Backup non riuscito.')); }} disabled={exportingData || erasingHealthData || (user !== null && status === 'withdrawn')}>{exportingData ? 'Preparazione…' : 'Prepara backup JSON'}</button>
        {erasingHealthData && <p role="status">Cancellazione e verifica dei dati cloud in corso. Non chiudere TheLogBook finché è possibile attendere l'esito.</p>}
        {preparedBackupUrl && <>
          <p role="status">Backup pronto. Tocca il collegamento qui sotto per scaricare il file sul dispositivo.</p>
          <a className="btn btn-primary" href={preparedBackupUrl} download="logbook_backup.json">Scarica backup JSON</a>
          <button type="button" className="btn" onClick={releasePreparedBackup}>Elimina il download preparato</button>
        </>}
        <button type="button" className="btn" disabled={erasingHealthData} onClick={() => void handleLogout()}>Esci dall'account</button>
        {user !== null && <button type="button" className="btn" disabled={erasingHealthData} onClick={() => void handleDeleteAccount()}>Elimina definitivamente l'account</button>}
        <button type="button" className="btn" disabled={busy || recoveryBusy || exportingData || erasingHealthData} onClick={() => { void reloadPage(); }}>Ricarica pagina</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
    {privacy && <PrivacyPolicy onClose={() => setPrivacy(false)} />}
    {terms && <TermsAndConditions onClose={() => setTerms(false)} />}
  </main>;
}
