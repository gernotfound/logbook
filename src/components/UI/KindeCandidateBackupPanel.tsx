import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import { KindeCandidateJsonPanel } from './KindeCandidateJsonPanel';

type Session = ReturnType<typeof useKindeAccountSession>;

/** Voluntary, importable Schema 3 backup before health-data withdrawal. */
export function KindeCandidateBackupPanel({
    session, active = true,
}: { session: Session; active?: boolean }) {
    return (
        <KindeCandidateJsonPanel label="Backup account prima della revoca"
            prepareLabel="Prepara backup JSON"
            downloadLabel="Scarica backup JSON"
            errorMessage="Backup non disponibile o sessione cambiata. Nessun dato è stato modificato. Verifica l’archivio e riprova."
            sessionBusy={session.busy} active={active}
            prepareFile={session.prepareCandidateBackup}>
            <p>Prima di revocare il consenso, puoi preparare una copia JSON dei dati
                verificabili del cloud e di questo dispositivo. Il file contiene
                dati sanitari leggibili: conservalo in un luogo riservato.</p>
            <p>Se le copie non sono coerenti, non verrà creato alcun backup
                completo. Il download è facoltativo e non revoca il consenso.</p>
        </KindeCandidateJsonPanel>
    );
}
