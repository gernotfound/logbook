import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import { KindeCandidateJsonPanel } from './KindeCandidateJsonPanel';

type Session = ReturnType<typeof useKindeAccountSession>;

/**
 * Rights remain independent of a fitness grant and device vault. The Worker,
 * not the UI phase, decides whether any cloud ciphertext is still readable.
 */
export function KindeCandidateRightsPanel({ session }: { session: Session }) {
    return (
        <KindeCandidateJsonPanel label="Accesso ai dati cloud dopo la revoca"
            prepareLabel="Verifica dati cloud ancora disponibili"
            downloadLabel="Scarica documenti cloud disponibili"
            errorMessage="Dati cloud non disponibili o sessione cambiata. La cancellazione può essere già avanzata o completata; non è stato creato un file incompleto."
            sessionBusy={session.busy}
            prepareFile={session.prepareCandidateRightsJson}>
            <p>Dopo la revoca, la cancellazione dei dati sanitari viene avviata
                automaticamente. Puoi richiedere soltanto i documenti cloud
                che risultano ancora leggibili in questo momento.</p>
            <p>Questo JSON è un’esportazione per esercitare i diritti, non un
                backup completo o ripristinabile: non comprende bozze,
                modifiche solo locali né documenti già cancellati.</p>
            <p>Il file contiene dati sanitari in chiaro. Conservalo in modo riservato.</p>
        </KindeCandidateJsonPanel>
    );
}
