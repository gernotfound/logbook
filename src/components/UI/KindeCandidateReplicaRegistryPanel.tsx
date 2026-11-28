import { useEffect, useRef, useState } from 'react';
import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import type { CloudReplicaControlSnapshot } from '../../lib/sync/cloudReplicaTransport';
import type { CandidateReplicaRetirementWitness } from '../../lib/sync/kindeCandidateReplicaRetirementBridge';
import type { CandidatePendingReplicaMutation } from '../../lib/sync/kindeCandidateReplicaCancellationBridge';
import { KindeCandidateJsonPanel } from './KindeCandidateJsonPanel';
import './kinde-replica-registry.css';

type Session = ReturnType<typeof useKindeAccountSession>;
type State = { kind: 'idle' | 'loading' | 'unavailable' }
    | { kind: 'observed'; control: CloudReplicaControlSnapshot };
type PendingState = { kind: 'idle' | 'loading' | 'none' | 'unavailable' }
    | { kind: 'observed'; mutation: CandidatePendingReplicaMutation };
type OfflineState = { kind: 'idle' | 'loading' | 'unavailable' }
    | { kind: 'observed'; result: Awaited<ReturnType<Session['inspectCandidateOfflineReplicaJournal']>> };
type RecoveryState = { kind: 'idle' | 'loading' | 'unavailable' }
    | { kind: 'observed'; result: Awaited<ReturnType<Session['inspectCandidateRetiredReplicaPreflight']>> };
type ConflictPreservationState = { kind: 'idle' | 'working' | 'unavailable' }
    | { kind: 'saved'; count: number; revision: number };

function dateText(milliseconds: number): string {
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? 'Data non rappresentabile'
        : new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Candidate-only read surface: never infers a physical device from a slot. */
export function KindeCandidateReplicaRegistryPanel({ session }: { session: Session }) {
    const [state, setState] = useState<State>({ kind: 'idle' });
    const [selected, setSelected] = useState<CandidateReplicaRetirementWitness | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [maintenance, setMaintenance] = useState<'idle' | 'working' | 'retired' | 'pending' | 'none' | 'unknown'>('idle');
    const [pendingState, setPendingState] = useState<PendingState>({ kind: 'idle' });
    const [cancelConfirmed, setCancelConfirmed] = useState(false);
    const [cancelOutcome, setCancelOutcome] = useState<'idle' | 'working' | 'cancelled' | 'committed' | 'pending' | 'unknown'>('idle');
    const [offlineState, setOfflineState] = useState<OfflineState>({ kind: 'idle' });
    const [recoveryState, setRecoveryState] = useState<RecoveryState>({ kind: 'idle' });
    const [conflictPreservation, setConflictPreservation] = useState<ConflictPreservationState>({ kind: 'idle' });
    const [receiptState, setReceiptState] = useState<'idle' | 'working' | 'acknowledged' | 'unconfirmed' | 'none' | 'unknown'>('idle');
    const mounted = useRef(false);
    const running = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const inspect = () => {
        if (running.current || session.busy) return;
        running.current = true;
        setSelected(null);
        setConfirmed(false);
        setMaintenance('idle');
        setPendingState({ kind: 'idle' });
        setCancelConfirmed(false);
        setCancelOutcome('idle');
        setOfflineState({ kind: 'idle' });
        setRecoveryState({ kind: 'idle' });
        setConflictPreservation({ kind: 'idle' });
        setReceiptState('idle');
        setState({ kind: 'loading' });
        void session.inspectCandidateReplicas().then(observed => {
            if (mounted.current) setState({ kind: 'observed', control: observed.control });
        }).catch(() => {
            if (mounted.current) setState({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const manage = (witness?: CandidateReplicaRetirementWitness) => {
        if (running.current || session.busy || (witness && !confirmed)) return;
        running.current = true;
        setMaintenance('working');
        setPendingState({ kind: 'idle' });
        setCancelConfirmed(false);
        setCancelOutcome('idle');
        setOfflineState({ kind: 'idle' });
        setRecoveryState({ kind: 'idle' });
        setConflictPreservation({ kind: 'idle' });
        setReceiptState('idle');
        void session.manageCandidateReplicaRetirement(witness).then(outcome => {
            if (!mounted.current) return;
            // The previously observed registry is no longer an authorization
            // for a second retirement, even if the first response was lost.
            setState({ kind: 'idle' });
            setSelected(null);
            setConfirmed(false);
            setMaintenance(outcome === 'retired' || outcome === 'superseded' ? 'retired'
                : outcome === 'idle' ? 'none' : 'pending');
        }).catch(() => {
            if (!mounted.current) return;
            setState({ kind: 'idle' });
            setSelected(null);
            setConfirmed(false);
            setMaintenance('unknown');
        }).finally(() => { running.current = false; });
    };

    const inspectPending = () => {
        if (running.current || session.busy) return;
        running.current = true;
        setState({ kind: 'idle' });
        setSelected(null);
        setConfirmed(false);
        setMaintenance('idle');
        setCancelConfirmed(false);
        setCancelOutcome('idle');
        setOfflineState({ kind: 'idle' });
        setRecoveryState({ kind: 'idle' });
        setConflictPreservation({ kind: 'idle' });
        setReceiptState('idle');
        setPendingState({ kind: 'loading' });
        void session.manageCandidateReplicaCancellation().then(mutation => {
            if (mounted.current) setPendingState(mutation ? { kind: 'observed', mutation } : { kind: 'none' });
        }).catch(() => {
            if (mounted.current) setPendingState({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const cancelPending = () => {
        if (running.current || session.busy || pendingState.kind !== 'observed' || !cancelConfirmed) return;
        running.current = true;
        setPendingState({ kind: 'idle' });
        setCancelConfirmed(false);
        setCancelOutcome('working');
        void session.manageCandidateReplicaCancellation(pendingState.mutation.mutationId).then(outcome => {
            if (mounted.current) setCancelOutcome(outcome === 'cancelled' ? 'cancelled'
                : outcome === 'committed' ? 'committed' : 'pending');
        }).catch(() => {
            if (mounted.current) setCancelOutcome('unknown');
        }).finally(() => { running.current = false; });
    };

    const inspectOffline = () => {
        if (running.current || session.busy) return;
        running.current = true;
        setState({ kind: 'idle' });
        setPendingState({ kind: 'idle' });
        setSelected(null);
        setConfirmed(false);
        setMaintenance('idle');
        setCancelConfirmed(false);
        setCancelOutcome('idle');
        setOfflineState({ kind: 'loading' });
        setRecoveryState({ kind: 'idle' });
        setConflictPreservation({ kind: 'idle' });
        setReceiptState('idle');
        void session.inspectCandidateOfflineReplicaJournal().then(result => {
            if (mounted.current) setOfflineState({ kind: 'observed', result });
        }).catch(() => {
            if (mounted.current) setOfflineState({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const inspectRecovery = () => {
        if (running.current || session.busy || offlineState.kind !== 'observed'
            || offlineState.result.kind !== 'retired-pending') return;
        running.current = true;
        setRecoveryState({ kind: 'loading' });
        setConflictPreservation({ kind: 'idle' });
        void session.inspectCandidateRetiredReplicaPreflight().then(result => {
            if (mounted.current) setRecoveryState({ kind: 'observed', result });
        }).catch(() => {
            if (mounted.current) setRecoveryState({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const preserveConflicts = () => {
        if (running.current || session.busy || recoveryState.kind !== 'observed'
            || recoveryState.result.kind !== 'reconciliation-required'
            || recoveryState.result.reason !== 'cloud-diverged'
            || recoveryState.result.evidence.entitiesWithCompetingVersions === 0) return;
        running.current = true;
        setConflictPreservation({ kind: 'working' });
        void session.preserveCandidateRetiredReplicaConflicts().then(result => {
            if (mounted.current) setConflictPreservation({ kind: 'saved',
                count: result.preservedEntities, revision: result.cloudRevision });
        }).catch(() => {
            if (mounted.current) setConflictPreservation({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const recoverReceipt = () => {
        if (running.current || session.busy || offlineState.kind !== 'observed'
            || offlineState.result.kind !== 'transition-pending'
            || offlineState.result.transition !== 'sealed-delivery') return;
        running.current = true;
        setReceiptState('working');
        void session.recoverCandidateStagedReceipt().then(result => {
            if (!mounted.current) return;
            setOfflineState({ kind: 'idle' });
            setReceiptState(result === 'acknowledged' ? 'acknowledged'
                : result === 'unconfirmed' ? 'unconfirmed' : 'none');
        }).catch(() => {
            if (mounted.current) setReceiptState('unknown');
        }).finally(() => { running.current = false; });
    };

    const entries = state.kind === 'observed'
        ? Object.entries(state.control.replicas).sort(([a], [b]) => a.localeCompare(b)) : [];
    const active = entries.filter(([, entry]) => entry.status === 'active').length;
    const disabled = session.busy || state.kind === 'loading' || pendingState.kind === 'loading'
        || offlineState.kind === 'loading'
        || recoveryState.kind === 'loading'
        || conflictPreservation.kind === 'working'
        || receiptState === 'working'
        || maintenance === 'working' || cancelOutcome === 'working';

    return (
        <section className="kinde-replica-registry" aria-label="Registro repliche account">
            <h2>Registrazioni di sincronizzazione</h2>
            <p>Puoi controllare le repliche associate all’account anche prima di registrare questo dispositivo. Una replica non identifica con certezza un telefono o un computer.</p>
            <button type="button" className="btn" onClick={inspect}
                disabled={disabled}>
                {state.kind === 'loading' ? 'Verifica in corso…' : 'Consulta il registro'}
            </button>
            <button type="button" className="btn" onClick={() => manage()}
                disabled={disabled}>
                Verifica una richiesta di ritiro in sospeso
            </button>
            <button type="button" className="btn" onClick={inspectPending} disabled={disabled}>
                {pendingState.kind === 'loading' ? 'Verifica richiesta locale…' : 'Esamina una richiesta da annullare'}
            </button>
            <button type="button" className="btn" onClick={inspectOffline} disabled={disabled}>
                {offlineState.kind === 'loading' ? 'Controllo modifiche offline…' : 'Controlla modifiche offline su questo dispositivo'}
            </button>
            {offlineState.kind === 'loading' && <p role="status">Verifica dell’archivio cifrato in corso, senza sincronizzare o modificare i dati…</p>}
            {offlineState.kind === 'unavailable' && <p role="alert">Non è possibile verificare il journal locale con questa sessione e questo archivio. Nessuna operazione è stata eseguita: non cancellare i dati del dispositivo.</p>}
            {offlineState.kind === 'observed' && <div className="kinde-replica-registry__confirmation">
                {offlineState.result.kind === 'no-pending' && <p role="status">Nessuna operazione nel journal corrente di questo archivio al momento della verifica. Questo non verifica eventuali bozze device o altri dispositivi offline.</p>}
                {offlineState.result.kind === 'archived-consent-pending' && <p role="alert">Il journal corrente è vuoto, ma l’archivio conserva {offlineState.result.archivedOperations} operazioni storiche di un consenso precedente. Non sono autorizzate al replay con il consenso corrente: conserva la copia per un recupero esplicito.</p>}
                {offlineState.result.kind === 'transition-pending' && <p role="alert">Esiste una transizione di sincronizzazione da riconciliare prima di valutare il recupero. Operazioni nel journal: {offlineState.result.pendingOperations}. Nessun dato è stato scartato.</p>}
                {offlineState.result.kind === 'transition-pending' && offlineState.result.transition === 'sealed-delivery' && <button className="btn" type="button"
                    disabled={disabled} onClick={recoverReceipt}>Verifica la ricevuta di un invio sigillato</button>}
                {offlineState.result.kind === 'transition-pending' && offlineState.result.transition === 'replica-management' && <p role="status">Questa transizione non è un invio sigillato: per registrazione, ritiro o annullamento usa la verifica della richiesta corrispondente.</p>}
                {offlineState.result.kind === 'first-claim-pending' && <p role="status">Questo archivio conserva {offlineState.result.pendingOperations} operazioni locali e non ha ancora una replica assegnata. Non è un rientro di replica ritirata; non è stata effettuata alcuna registrazione.</p>}
                {offlineState.result.kind === 'active-pending' && <p role="status">La replica {offlineState.result.slot} (generazione {offlineState.result.generation}) risultava attiva nel registro verificato. Restano {offlineState.result.pendingOperations} operazioni locali non confermate: questa osservazione non è un ACK né autorizza il replay senza i controlli ordinari.</p>}
                {offlineState.result.kind === 'retired-pending' && <p role="alert"><strong>Recupero necessario:</strong> {offlineState.result.pendingOperations} operazioni restano nel journal locale senza ACK verificato della replica {offlineState.result.slot} (generazione {offlineState.result.generation}). La sua registrazione non è più utilizzabile ({offlineState.result.reason === 'retired' ? 'ritirata' : offlineState.result.reason === 'replaced' ? 'sostituita' : offlineState.result.reason === 'expired' ? 'scaduta' : 'non presente nel registro'}). Non eliminare l’archivio e non tentare di riattribuire automaticamente le modifiche: la riconciliazione causale è ancora da completare.</p>}
                {offlineState.result.kind === 'retired-pending' && <button className="btn" type="button" disabled={disabled}
                    onClick={inspectRecovery}>Analizza la copia cloud e i possibili conflitti</button>}
                {offlineState.result.kind === 'retired-pending' && <KindeCandidateJsonPanel
                    label="Copia di sicurezza delle versioni per replica ritirata"
                    prepareLabel="Prepara copia delle versioni offline e cloud"
                    downloadLabel="Scarica le versioni separate"
                    errorMessage="Impossibile preparare una copia verificata: sessione, registro o dati potrebbero essere cambiati. L’archivio locale non è stato modificato."
                    sessionBusy={session.busy || disabled}
                    prepareFile={session.prepareCandidateRetiredReplicaEvidence}>
                    <p>Questa esportazione facoltativa conserva in un file JSON separato le versioni del cloud e di questo dispositivo, il journal non confermato e le bozze disponibili. <strong>Non recupera né sincronizza le modifiche</strong> e non sostituisce un backup ripristinabile.</p>
                    <p>Il file contiene dati sanitari in chiaro: salvalo in un luogo protetto e non condividerlo. Dopo il download, conserva anche l’archivio originale su questo dispositivo: il browser non può confermare che il file sia stato effettivamente salvato.</p>
                </KindeCandidateJsonPanel>}
                <p>Il controllo del journal è di sola lettura: il cloud può evolvere successivamente. La verifica separata di una ricevuta può confermare solo un invio originale già effettuato, senza cancellare bozze o operazioni successive.</p>
            </div>}
            {receiptState === 'working' && <p role="status">Verifica della ricevuta storica in corso, senza ritrasmissioni al cloud…</p>}
            {receiptState === 'acknowledged' && <p role="status">La ricevuta dell’invio originale è stata verificata e il suo ACK è stato salvato nell’archivio cifrato. Eventuali operazioni successive non sono state confermate.</p>}
            {receiptState === 'unconfirmed' && <p role="alert">Nessuna ricevuta storica verificabile: l’invio può avere esito incerto. Journal e ciphertext sono conservati senza inviare nuovi dati.</p>}
            {receiptState === 'none' && <p role="status">Non esiste un invio sigillato da confermare. Le altre richieste in sospeso richiedono la loro procedura dedicata.</p>}
            {receiptState === 'unknown' && <p role="alert">Impossibile concludere la verifica della ricevuta. Un ACK potrebbe essere stato salvato prima dell’errore: ricontrolla il journal e conserva l’archivio.</p>}
            {recoveryState.kind === 'loading' && <p role="status">Confronto cifrato completo con il cloud in corso, senza inviare modifiche…</p>}
            {recoveryState.kind === 'unavailable' && <p role="alert">Non è stato possibile verificare la copia cloud con una chiave cloud già emessa e la sessione corrente. L’esito resta sconosciuto: conserva l’archivio locale.</p>}
            {recoveryState.kind === 'observed' && <div className="kinde-replica-registry__confirmation">
                {recoveryState.result.kind === 'baseline-unchanged'
                    ? <p role="status">Alla revisione cloud {recoveryState.result.cloudRevision}, la copia remota corrispondeva alla base delle {recoveryState.result.pendingOperations} operazioni locali. Non sono state recuperate né confermate: occorrono ancora una nuova identità causale e prove aggiornate prima del trasferimento.</p>
                    : recoveryState.result.reason === 'cloud-diverged'
                        ? <p role="alert">La copia cloud è cambiata rispetto alla base locale. Sono stati osservati {recoveryState.result.evidence.changedCloudFieldStamps} stamp causali differenti, {recoveryState.result.evidence.pendingWithOverlappingCloudStamps} operazioni con possibili sovrapposizioni di campi, {recoveryState.result.evidence.entitiesWithCompetingVersions} giornate o allenamenti con versioni business differenti e {recoveryState.result.evidence.unclassifiedDocuments} documenti con divergenza non classificabile. Le modifiche su campi diversi della stessa giornata o dello stesso allenamento richiedono comunque riconciliazione: nessuna versione viene scelta o sovrascritta.</p>
                        : <p role="alert">Il confronto non permette il recupero: {recoveryState.result.reason === 'possible-lost-ack' ? 'potrebbe esistere un invio già applicato senza conferma locale.'
                            : recoveryState.result.reason === 'replica-active' ? 'la replica originale è ancora eleggibile nel registro.'
                                : recoveryState.result.reason === 'unverifiable-lineage' ? 'il registro non conserva una storia coerente della replica originale: non è possibile escludere invii precedenti.'
                                : recoveryState.result.reason === 'transition' ? 'esiste una richiesta o consegna cifrata da riconciliare.'
                                    : recoveryState.result.reason === 'local-replay-diverged' ? 'il journal non riproduce esattamente lo stato locale.'
                                        : recoveryState.result.reason === 'no-old-replica' ? 'manca un’identità causale originale verificabile.'
                                            : 'non esistono più operazioni pendenti nella copia riletta.'}</p>}
                {recoveryState.result.kind === 'reconciliation-required'
                    && recoveryState.result.reason === 'cloud-diverged'
                    && recoveryState.result.evidence.entitiesWithCompetingVersions > 0
                    && <button type="button" className="btn" disabled={disabled || conflictPreservation.kind === 'saved'}
                        onClick={preserveConflicts}>Conserva le versioni concorrenti nell’archivio cifrato</button>}
                <p>Diagnosi temporanea di sola lettura: nessun ACK, claim, scelta di conflitto o riattribuzione del journal. Non cancellare questa copia finché il recupero non sarà disponibile.</p>
            </div>}
            {conflictPreservation.kind === 'working' && <p role="status">Nuovo confronto autenticato e salvataggio cifrato delle versioni: nessuna modifica inviata al cloud…</p>}
            {conflictPreservation.kind === 'saved' && <p role="status">{conflictPreservation.count === 1
                ? 'Conservata 1 entità con versioni concorrenti' : `Conservate ${conflictPreservation.count} entità con versioni concorrenti`}, insieme alle alternative e al journal originale, nell’archivio cifrato di questo dispositivo (revisione cloud osservata {conflictPreservation.revision}). È una copia storica: nessuna versione è stata scelta o sincronizzata. Conserva questo dispositivo.</p>}
            {conflictPreservation.kind === 'unavailable' && <p role="alert">Conservazione non confermata: una scheda concorrente, la sessione, il consenso o la copia cloud potrebbero essere cambiati. Verifica nuovamente l’archivio prima di riprovare. Non eliminare il journal originale.</p>}
            {pendingState.kind === 'loading' && <p role="status">Lettura della richiesta cifrata in corso…</p>}
            {pendingState.kind === 'none' && <p role="status">Nessuna richiesta di registrazione o ritiro in sospeso in questo archivio.</p>}
            {pendingState.kind === 'unavailable' && <p role="alert">Impossibile verificare una richiesta locale: nessun annullamento eseguito.</p>}
            {pendingState.kind === 'observed' && <div className="kinde-replica-registry__confirmation">
                <p><strong>Richiesta cifrata da verificare:</strong> {pendingState.mutation.kind === 'claim' ? 'registrazione della replica' : 'ritiro della replica'}.
                    {pendingState.mutation.slot !== null && <> Replica {pendingState.mutation.slot}, generazione {pendingState.mutation.generation}.</>}
                    {' '}Riferimento operazione: <code>{pendingState.mutation.mutationId}</code>.</p>
                {pendingState.mutation.cancellationRequested && <p role="alert">Annullamento già richiesto: occorre riconciliare la stessa richiesta con il server.</p>}
                <p>L’annullamento non elimina dati o modifiche locali. Se il server ha già eseguito la richiesta, non può annullarne retroattivamente gli effetti; servirà un recupero separato. Una risposta persa non prova l’annullamento.</p>
                <label><input type="checkbox" disabled={disabled} checked={cancelConfirmed}
                    onChange={event => setCancelConfirmed(event.target.checked)} /> Confermo di voler annullare proprio questa richiesta dopo averne letto il riferimento.</label>
                <button className="btn btn-primary" type="button" disabled={disabled || !cancelConfirmed}
                    onClick={cancelPending}>Conferma annullamento richiesta</button>
                <button className="btn" type="button" disabled={disabled}
                    onClick={() => { setPendingState({ kind: 'idle' }); setCancelConfirmed(false); }}>Torna senza modifiche</button>
            </div>}
            {cancelOutcome === 'working' && <p role="status">Annullamento e controllo della revisione server in corso…</p>}
            {cancelOutcome === 'cancelled' && <p role="status">Il server ha provato che la richiesta non è stata eseguita e l’annullamento è stato riconciliato. Il journal locale non è stato cancellato.</p>}
            {cancelOutcome === 'committed' && <p role="alert">La richiesta originale risulta già eseguita: l’annullamento non la ripristina. Procedi con il recupero della registrazione o del ritiro, senza crearne un’altra.</p>}
            {cancelOutcome === 'pending' && <p role="alert">Annullamento non ancora riconciliato. La decisione e la richiesta originali rimangono sigillate; esamina di nuovo la stessa richiesta.</p>}
            {cancelOutcome === 'unknown' && <p role="alert">Esito dell’annullamento sconosciuto. Non presumere successo: riesamina la richiesta locale prima di altre operazioni.</p>}
            {maintenance === 'working' && <p role="status">Verifica del ritiro e delle ricevute in corso…</p>}
            {maintenance === 'retired' && <p role="status">Il ritiro è stato verificato sul registro. Consulta nuovamente il registro prima di altre operazioni; gli eventuali dati rimasti offline sull’altra replica non sono stati recuperati.</p>}
            {maintenance === 'none' && <p role="status">Nessuna richiesta di ritiro cifrata in sospeso in questo archivio locale.</p>}
            {maintenance === 'pending' && <p role="alert">Ritiro ancora da riconciliare: l’operazione e il journal locale sono conservati. Non ripetere la selezione; usa la verifica della richiesta in sospeso.</p>}
            {maintenance === 'unknown' && <p role="alert">Esito del ritiro non verificabile. La richiesta potrebbe essere già stata salvata o inviata: controlla la richiesta in sospeso prima di scegliere un’altra replica.</p>}
            {state.kind === 'loading' && <p role="status">Lettura del registro in corso…</p>}
            {state.kind === 'unavailable' && <p role="alert">Registro non verificabile in questa sessione. Nessuna replica o dato locale è stato modificato.</p>}
            {state.kind === 'observed' && (
                <div>
                    <p role="status">{active} {active === 1 ? 'replica contrassegnata attiva' : 'repliche contrassegnate attive'} nel registro, su {entries.length} {entries.length === 1 ? 'registrazione' : 'registrazioni'}.</p>
                    {entries.length === 0
                        ? <p>Il registro verificato non contiene ancora repliche.</p>
                        : <ol className="kinde-replica-registry__list">
                            {entries.map(([slot, entry]) => (
                                <li key={slot + ':' + entry.generation}>
                                    <strong>Replica {slot} · generazione {entry.generation}</strong>
                                    <span>Stato nel registro: {entry.status === 'active' ? 'attiva' : 'ritirata'}</span>
                                    <span>Ultimo checkpoint: {dateText(entry.checkpointAtMs)}</span>
                                    <span>Scadenza registrata: {dateText(entry.leaseUntilMs)}</span>
                                    {entry.status === 'active' && <button className="btn" type="button"
                                        disabled={disabled}
                                        onClick={() => {
                                            setSelected({ slot, replicaId: entry.replicaId, generation: entry.generation,
                                                lastSeq: entry.lastSeq, checkpointAtMs: entry.checkpointAtMs,
                                                leaseUntilMs: entry.leaseUntilMs });
                                            setConfirmed(false);
                                        }}>Prepara ritiro replica {slot}</button>}
                                    {selected?.slot === slot && selected.replicaId === entry.replicaId
                                        && selected.generation === entry.generation && <div className="kinde-replica-registry__confirmation">
                                            <p><strong>Attenzione:</strong> ritirare la replica {slot} può impedire di recuperare modifiche rimaste soltanto offline su quel dispositivo. Non è un logout, una cancellazione dell’account o una prova che il dispositivo sia online. Verifica prima le copie locali.</p>
                                            <label><input type="checkbox" checked={confirmed}
                                                disabled={disabled}
                                                onChange={event => setConfirmed(event.target.checked)} /> Confermo di voler ritirare questa replica tecnica e di accettare il rischio di perdita delle modifiche offline non sincronizzate.</label>
                                            <button className="btn btn-primary" type="button"
                                                disabled={!confirmed || disabled}
                                                onClick={() => manage(selected)}>Conferma ritiro replica {slot}</button>
                                            <button className="btn" type="button"
                                                disabled={disabled}
                                                onClick={() => { setSelected(null); setConfirmed(false); }}>Annulla selezione</button>
                                        </div>}
                                    <details>
                                        <summary className="disclosure-summary">Identificativo tecnico e sequenza</summary>
                                        <code>{entry.replicaId}</code>
                                        <span>Sequenza confermata: {entry.lastSeq}</span>
                                    </details>
                                </li>
                            ))}
                        </ol>}
                    <p>Lo stato del registro non dimostra che un dispositivo sia online o che tutte le modifiche offline siano state inviate. Il ritiro è disponibile solo in questo percorso candidato isolato; richiede conferma e prova remota, senza cancellare il journal locale.</p>
                </div>
            )}
        </section>
    );
}
