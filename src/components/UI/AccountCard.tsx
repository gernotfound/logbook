import { lazy, Suspense } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../hooks/useSettings';

const LegacyAccountCard = lazy(() => import('./AccountCardLegacy').then(module => ({ default: module.LegacyAccountCard })));

function GuestAccountCard() {
    const { handleLogout } = useSettings();
    return (
        <div className="card">
            <h2 className="ui-account-card-1" style={{ marginTop: 0 }}>Modalità locale</h2>
            <p className="ui-account-card-2">
                I tuoi dati restano salvati su questo dispositivo.
                Il passaggio a un account Kinde sarà disponibile solo dopo
                il collaudo del trasferimento sicuro: nessun dato viene inviato
                o collegato automaticamente a un account.
            </p>
            <button type="button" className="btn ui-account-card-5"
                onClick={handleLogout}>Esci dalla modalità locale</button>
        </div>
    );
}

export function AccountCard() {
    const { currentUser, isGuest } = useAuth();
    if (isGuest && !currentUser) return <GuestAccountCard />;
    if (!currentUser || isGuest) return null;

    // Legacy account controls must not initialize Firebase in the guest/Kinde-only entry.
    return <Suspense fallback={<div className="card" role="status">Caricamento gestione account…</div>}>
        <LegacyAccountCard key={currentUser.uid} />
    </Suspense>;
}
