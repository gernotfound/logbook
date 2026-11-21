import { createElement, Fragment, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KindeCandidateNutritionPlanning } from '../../src/components/Nutrition/KindeCandidateNutritionPlanning';
import { useKindeAccountSession } from '../../src/contexts/auth/useKindeAccountSession';
import { useKindeCandidateFitnessLifecycle } from '../../src/contexts/auth/useKindeCandidateFitnessLifecycle';

export { openKindeCandidateFitnessRealm } from '../../src/lib/auth/kindeCandidateFitnessRealm';

function CandidatePlanning() {
    const session = useKindeAccountSession({ guestArchivePresent: false, identityOnly: false });
    const realm = useKindeCandidateFitnessLifecycle({ session, enabled: true });
    const [failed, setFailed] = useState(false);
    const run = (action: () => Promise<void>) => {
        setFailed(false);
        void action().catch(() => setFailed(true));
    };
    return createElement(Fragment, null,
        createElement('button', {
            type: 'button', disabled: session.view.phase !== 'consent-confirmed' || realm.state.phase !== 'closed',
            onClick: () => run(realm.open),
        }, 'Apri archivio account'),
        realm.state.phase === 'recheck-required'
            ? createElement('button', {
                type: 'button', onClick: () => run(realm.recheck),
            }, 'Verifica salvataggio')
            : null,
        failed || realm.state.phase === 'unavailable'
            ? createElement('p', { role: 'alert' }, 'Archivio account non disponibile')
            : null,
        createElement(KindeCandidateNutritionPlanning, { realm }),
    );
}

export function mountKindePlanning(): void {
    const root = document.createElement('div');
    document.body.append(root);
    createRoot(root).render(createElement(CandidatePlanning));
}
