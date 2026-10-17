import { useState, type RefObject } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { DB } from '../lib/db';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { currentHealthConsentStatus } from '../lib/healthConsent';
import { auth, signOut } from '../lib/firebase';
import { purgeCompletedHealthDataLocal } from '../lib/db/db_account';
import { requestHealthDataErasure } from '../lib/healthDataErasure';
import { isSensitiveReauthCancellation, reauthenticateForSensitiveAction } from '../lib/auth/recentAuth';

export type SettingsDeletionInFlight = 'account' | 'health-data' | null;

export function useSettingsHealthDataDeletion(deletionBusy: RefObject<SettingsDeletionInFlight>) {
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showPasswordPrompt = useDialogStore(state => state.showPasswordPrompt);
    const [erasingHealthData, setErasingHealthData] = useState(false);

    const handleDeleteHealthData = async () => {
        if (deletionBusy.current !== null) return;
        deletionBusy.current = 'health-data';
        let serverComplete = false;
        try {
            const user = auth.currentUser;
            const session = captureSession();
            if (!user || session.owner !== 'user:' + user.uid) {
                throw new Error('Accedi al tuo account prima di richiedere la cancellazione.');
            }
            const assertCurrent = () => {
                if (!isCurrentSession(session) || auth.currentUser?.uid !== user.uid) {
                    throw new Error('Sessione cambiata durante la cancellazione. Verifica il risultato prima di riprovare.');
                }
            };
            if (currentHealthConsentStatus(user.uid) !== 'withdrawn') {
                throw new Error('Prima di eliminare i dati, attendi la conferma della revoca del consenso sul server.');
            }
            if (navigator.onLine === false) {
                throw new Error('Per cancellare i dati cloud devi essere connesso a Internet.');
            }
            if (!(await showConfirm(
                'Verranno rimossi dal database operativo TheLogBook e da questo dispositivo allenamenti, nutrizione, misurazioni, schede, bozze e copie di recupero locali.\\n\\nIl tuo account Firebase (email e accesso) resterà esistente, ma verrai disconnesso. Dispositivi offline, backup JSON già scaricati e possibili copie tecniche del fornitore possono conservare dati soggetti a tempi di conservazione separati.\\n\\nEsporta prima un backup solo se desideri conservare una copia dei dati. Vuoi procedere?'
            ))) return;
            assertCurrent();
            if (!(await showConfirm(
                'ULTIMA CONFERMA: tutti i dati fitness e nutrizione salvati saranno eliminati senza possibilità di recuperarli tramite TheLogBook. L’operazione cloud può impiegare tempo e non potrà essere annullata una volta avviata. Confermi?'
            ))) return;
            assertCurrent();
            let reauth = await reauthenticateForSensitiveAction(user);
            assertCurrent();
            if (reauth === 'password-required') {
                const password = await showPasswordPrompt('Inserisci la password attuale per confermare la cancellazione dei dati.', 'Verifica identità');
                if (password === null) return;
                assertCurrent();
                reauth = await reauthenticateForSensitiveAction(user, password);
            }
            assertCurrent();
            if (reauth === 'redirect-started') {
                await showAlert('La verifica Google è stata avviata. Completa l’accesso e ripeti la cancellazione.');
                return;
            }
            if (reauth !== 'reauthenticated') {
                throw new Error('Non è stato possibile verificare nuovamente la tua identità.');
            }
            setErasingHealthData(true);
            assertCurrent();
            useAppStore.getState().cancelPendingSyncs();
            const result = await requestHealthDataErasure(user);
            assertCurrent();
            if (!result.complete) {
                const message = result.status === 'failed'
                    ? 'La cancellazione cloud è incompleta e potrebbe aver già eliminato parte dei dati. Riprova dopo aver verificato il servizio. Se il problema persiste, richiedi assistenza.'
                    : 'La richiesta è stata accettata, ma la cancellazione cloud è ancora in corso. I dati locali rimangono conservati e bloccati. Riprova più tardi per verificare il completamento.';
                await showAlert(message, 'Cancellazione non ancora completata');
                return;
            }
            serverComplete = true;
            // Auth may still be live, but user data must not be republished.
            // Purge verifies IndexedDB removal before erasing encryption keys.
            await purgeCompletedHealthDataLocal(session.owner);
            // The completed purge removes the consent marker itself; this
            // intentionally invalidates the pre-erasure session snapshot.
            if (auth.currentUser?.uid !== user.uid) {
                throw new Error('Account cambiato dopo la pulizia locale.');
            }
            DB.resetCache();
            useAppStore.getState().resetStore({ force: true });
            await signOut(auth);
            await showAlert('Dati del database operativo e di questo dispositivo eliminati. Il tuo account non è stato cancellato: puoi accedere di nuovo. Copie su dispositivi offline, backup già esportati e backup tecnici del fornitore non sono eliminabili da questo comando.', 'Cancellazione completata');
        } catch (error) {
            if (isSensitiveReauthCancellation(error)) return;
            await showAlert(
                (serverComplete
                    ? 'Il server ha completato la cancellazione, ma la pulizia su questo dispositivo o la disconnessione non è terminata. Non considerare conclusa la pulizia locale. Riprova da questo dispositivo.\\n\\n'
                    : 'La cancellazione potrebbe essere stata avviata: non ripristinare vecchie copie senza aver verificato lo stato.\\n\\n')
                + (error instanceof Error ? error.message : 'Verifica cancellazione non riuscita.'),
                'Cancellazione da verificare',
            );
        } finally {
            deletionBusy.current = null;
            setErasingHealthData(false);
        }
    };

    return { erasingHealthData, handleDeleteHealthData };
}
