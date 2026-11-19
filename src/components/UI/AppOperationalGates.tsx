import type { AuthContextType } from '../../contexts/AuthContextDef';

interface RequiredUpdateGateProps {
  compatibilityError: string | null;
  requiredUpdateReloadError: string | null;
  requiredUpdateReloading: boolean;
  onReload: () => void;
}

export function RequiredUpdateGate({ compatibilityError, requiredUpdateReloadError, requiredUpdateReloading, onReload }: RequiredUpdateGateProps) {
    return (
      <div id="auth-overlay" role="alert" aria-live="assertive">
        <div className="auth-panel">
          <h1 className="text-primary mb-10">Aggiornamento richiesto</h1>
          <p style={{ lineHeight: 1.5 }}>
            Questa copia di TheLogBook non può modificare in sicurezza i dati trovati. I dati locali e cloud sono stati lasciati intatti.
          </p>
          <p className="text-muted">
            {compatibilityError ?? 'Aggiorna TheLogBook alla versione più recente prima di continuare.'}
          </p>
          {requiredUpdateReloadError && (
            <p role="alert" className="text-muted">
              {requiredUpdateReloadError}
            </p>
          )}
          <button
            type="button"
            onClick={onReload}
            className="btn btn-primary"
            disabled={requiredUpdateReloading}
          >
            {requiredUpdateReloading ? 'Aggiornamento…' : 'Ricarica TheLogBook'}
          </button>
        </div>
      </div>
    );
}

interface GuestMigrationFailureGateProps {
  isGuest: boolean;
  retryGuestMigration: AuthContextType['retryGuestMigration'];
}

export function GuestMigrationFailureGate({ isGuest, retryGuestMigration }: GuestMigrationFailureGateProps) {
    return (
      <div id="auth-overlay" style={{ zIndex: 10001 }} role="alert" aria-live="assertive">
        <div className="auth-panel">
          <h1 className="text-primary mb-10">Accesso non completato</h1>
          <p style={{ lineHeight: 1.5 }}>
            I dati salvati su questo dispositivo sono stati conservati.
          </p>
          <p className="text-muted">
            {isGuest
              ? 'Scegli esplicitamente come gestire i dati locali prima di continuare.'
              : 'Riprova per completare in sicurezza la preparazione dell’account.'}
          </p>
          {isGuest ? (
            <div style={{ display: 'grid', gap: '10px' }}>
              <button
                type="button"
                onClick={() => void retryGuestMigration('merge')}
                className="btn btn-primary"
              >
                Trasferisci i progressi nell’account
              </button>
              <button
                type="button"
                onClick={() => void retryGuestMigration('skip')}
                className="btn"
              >
                Non trasferire i progressi
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void retryGuestMigration()}
              className="btn btn-primary"
            >
              Riprova
            </button>
          )}
        </div>
      </div>
    );
}
